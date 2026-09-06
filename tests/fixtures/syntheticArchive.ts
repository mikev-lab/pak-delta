/**
 * Procedural Synthetic Archive Generator for pak-delta tests.
 * Generates deterministic, in-memory ZIP/PAK binary containers with zero external dependencies.
 */

// IEEE 802.3 bitwise CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Deterministic 32-bit PRNG (mulberry32)
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticEntrySpec {
  name: string;
  data: Uint8Array;
  compressed?: boolean; // Default true (method 8)
  useDataDescriptor?: boolean; // Default false (Bit 3)
}

export interface SyntheticArchiveBuildOptions {
  entries: SyntheticEntrySpec[];
  sectorAlignment?: number; // E.g. 4096 for Unreal DMA sector alignment
  comment?: Uint8Array; // Optional EOCD archive comment
}

/**
 * Compresses an uncompressed buffer using native CompressionStream("deflate-raw").
 */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export interface BuiltEntryRecord {
  name: string;
  uncompressedData: Uint8Array;
  compressedData: Uint8Array;
  compressionMethod: number; // 0 = Stored, 8 = Deflated
  crc32: number;
  uncompressedSize: number;
  compressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
  alignmentPadding: number;
  useDataDescriptor: boolean;
}

export interface BuiltSyntheticArchive {
  bytes: Uint8Array;
  records: BuiltEntryRecord[];
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  commentLength: number;
}

/**
 * Builds a deterministic synthetic ZIP/PAK archive in memory.
 */
export async function buildSyntheticArchive(options: SyntheticArchiveBuildOptions): Promise<BuiltSyntheticArchive> {
  const alignment = options.sectorAlignment ?? 0;
  const comment = options.comment ?? new Uint8Array(0);
  const records: BuiltEntryRecord[] = [];
  const parts: Uint8Array[] = [];
  let currentOffset = 0;

  // 1. Process and write Local File Records
  for (const entry of options.entries) {
    const isCompressed = entry.compressed !== false;
    const method = isCompressed ? 8 : 0;
    const crc = computeCrc32(entry.data);
    const uncompressedSize = entry.data.length;
    const compressedData = isCompressed ? await deflateRaw(entry.data) : entry.data;
    const compressedSize = compressedData.length;
    const useDescriptor = !!entry.useDataDescriptor;

    const nameBytes = new TextEncoder().encode(entry.name);
    const extraField = new Uint8Array(0);

    const localHeaderOffset = currentOffset;

    // Local File Header (30 bytes + name + extra)
    const lfh = new Uint8Array(30 + nameBytes.length + extraField.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true); // Signature
    lfhView.setUint16(4, 20, true); // Version needed (2.0)
    lfhView.setUint16(6, useDescriptor ? 0x0008 : 0, true); // Bit flag
    lfhView.setUint16(8, method, true); // Compression method
    lfhView.setUint16(10, 0x5455, true); // Time (10:34:42)
    lfhView.setUint16(12, 0x5821, true); // Date (2024-01-01)
    lfhView.setUint32(14, useDescriptor ? 0 : crc, true); // CRC32
    lfhView.setUint32(18, useDescriptor ? 0 : compressedSize, true); // Compressed size
    lfhView.setUint32(22, useDescriptor ? 0 : uncompressedSize, true); // Uncompressed size
    lfhView.setUint16(26, nameBytes.length, true); // Filename length
    lfhView.setUint16(28, extraField.length, true); // Extra field length
    lfh.set(nameBytes, 30);
    lfh.set(extraField, 30 + nameBytes.length);

    parts.push(lfh);
    currentOffset += lfh.length;

    const dataOffset = currentOffset;
    parts.push(compressedData);
    currentOffset += compressedData.length;

    // Trailing Data Descriptor if bit 3 set (16 bytes: 0x08074b50 + crc + cSize + uSize)
    if (useDescriptor) {
      const dd = new Uint8Array(16);
      const ddView = new DataView(dd.buffer);
      ddView.setUint32(0, 0x08074b50, true);
      ddView.setUint32(4, crc, true);
      ddView.setUint32(8, compressedSize, true);
      ddView.setUint32(12, uncompressedSize, true);
      parts.push(dd);
      currentOffset += dd.length;
    }

    // Sector Alignment Padding if alignment specified
    let paddingBytes = 0;
    if (alignment > 0) {
      const remainder = currentOffset % alignment;
      if (remainder !== 0) {
        paddingBytes = alignment - remainder;
        const padding = new Uint8Array(paddingBytes);
        parts.push(padding);
        currentOffset += paddingBytes;
      }
    }

    records.push({
      name: entry.name,
      uncompressedData: entry.data,
      compressedData,
      compressionMethod: method,
      crc32: crc,
      uncompressedSize,
      compressedSize,
      localHeaderOffset,
      dataOffset,
      alignmentPadding: paddingBytes,
      useDataDescriptor: useDescriptor,
    });
  }

  // 2. Central Directory
  const centralDirectoryOffset = currentOffset;
  const cdParts: Uint8Array[] = [];

  for (const record of records) {
    const nameBytes = new TextEncoder().encode(record.name);
    const extraField = new Uint8Array(0);
    const commentBytes = new Uint8Array(0);

    const cdfh = new Uint8Array(46 + nameBytes.length + extraField.length + commentBytes.length);
    const cdfhView = new DataView(cdfh.buffer);
    cdfhView.setUint32(0, 0x02014b50, true); // Central Directory signature
    cdfhView.setUint16(4, 0x0314, true); // Version made by (Unix, 2.0)
    cdfhView.setUint16(6, 20, true); // Version needed (2.0)
    cdfhView.setUint16(8, record.useDataDescriptor ? 0x0008 : 0, true); // General purpose bit flag
    cdfhView.setUint16(10, record.compressionMethod, true); // Compression method
    cdfhView.setUint16(12, 0x5455, true); // Time
    cdfhView.setUint16(14, 0x5821, true); // Date
    cdfhView.setUint32(16, record.crc32, true); // Authoritative CRC32
    cdfhView.setUint32(20, record.compressedSize, true); // Authoritative Compressed size
    cdfhView.setUint32(24, record.uncompressedSize, true); // Authoritative Uncompressed size
    cdfhView.setUint16(28, nameBytes.length, true); // Filename length
    cdfhView.setUint16(30, extraField.length, true); // Extra field length
    cdfhView.setUint16(32, commentBytes.length, true); // File comment length
    cdfhView.setUint16(34, 0, true); // Disk number start
    cdfhView.setUint16(36, 0, true); // Internal file attributes
    cdfhView.setUint32(38, 0x81A40000, true); // External file attributes (-rw-r--r--)
    cdfhView.setUint32(42, record.localHeaderOffset, true); // Relative offset of local header
    cdfh.set(nameBytes, 46);
    cdfh.set(extraField, 46 + nameBytes.length);
    cdfh.set(commentBytes, 46 + nameBytes.length + extraField.length);

    cdParts.push(cdfh);
    currentOffset += cdfh.length;
  }

  const centralDirectorySize = currentOffset - centralDirectoryOffset;
  parts.push(...cdParts);

  // 3. End of Central Directory (EOCD)
  const eocd = new Uint8Array(22 + comment.length);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true); // Disk number
  eocdView.setUint16(6, 0, true); // Disk number with Central Directory
  eocdView.setUint16(8, records.length, true); // Total entries on disk
  eocdView.setUint16(10, records.length, true); // Total entries
  eocdView.setUint32(12, centralDirectorySize, true); // Central Directory size
  eocdView.setUint32(16, centralDirectoryOffset, true); // Offset of Central Directory
  eocdView.setUint16(20, comment.length, true); // Comment length
  if (comment.length > 0) {
    eocd.set(comment, 22);
  }

  parts.push(eocd);
  currentOffset += eocd.length;

  // Flatten all parts into single Uint8Array
  const totalLength = currentOffset;
  const result = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const part of parts) {
    result.set(part, writeOffset);
    writeOffset += part.length;
  }

  return {
    bytes: result,
    records,
    centralDirectoryOffset,
    centralDirectorySize,
    commentLength: comment.length,
  };
}

/**
 * Creates random synthetic asset payload bytes with a deterministic seed.
 */
export function generateSyntheticPayload(size: number, seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const data = new Uint8Array(size);
  // Generate semi-repetitive game asset pattern (like texture / geometry data)
  for (let i = 0; i < size; i++) {
    if (i % 64 === 0) {
      data[i] = Math.floor(rng() * 256);
    } else {
      data[i] = (data[i - 1] + Math.floor(rng() * 5)) & 0xFF;
    }
  }
  return data;
}
