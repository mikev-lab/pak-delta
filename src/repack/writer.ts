/**
 * Deterministic ZIP/PAK binary container serializer.
 * Assembles Local File Headers, compressed/stored payloads, sector alignment padding,
 * Central Directory File Headers, and the End of Central Directory record.
 */

export interface ContainerEntryToWrite {
  name: string;
  compressionMethod: number; // 0 = Stored, 8 = Deflated
  crc32: number;
  uncompressedSize: number;
  compressedSize: number;
  data: Uint8Array;
  alignmentPadding?: number;
  extraField?: Uint8Array;
  comment?: Uint8Array;
}

export interface SerializedContainerResult {
  bytes: Uint8Array;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

/**
 * Serializes an array of container entries into a deterministic binary ZIP/PAK container buffer.
 */
export function serializeArchive(
  entries: ContainerEntryToWrite[],
  archiveComment: Uint8Array = new Uint8Array(0)
): SerializedContainerResult {
  const parts: Uint8Array[] = [];
  let currentOffset = 0;
  const textEncoder = new TextEncoder();

  interface InternalEntryRecord {
    entry: ContainerEntryToWrite;
    nameBytes: Uint8Array;
    extraField: Uint8Array;
    commentBytes: Uint8Array;
    localHeaderOffset: number;
  }

  const recordedEntries: InternalEntryRecord[] = [];

  // 1. Write Local File Records (Header + Payload + Sector Alignment Padding)
  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const extraField = entry.extraField ?? new Uint8Array(0);
    const commentBytes = entry.comment ?? new Uint8Array(0);
    const localHeaderOffset = currentOffset;

    // LFH: 30 bytes + name + extra
    const lfh = new Uint8Array(30 + nameBytes.length + extraField.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true); // Signature
    lfhView.setUint16(4, 20, true); // Version needed (2.0)
    lfhView.setUint16(6, 0, true); // Bit flags
    lfhView.setUint16(8, entry.compressionMethod, true); // Method
    lfhView.setUint16(10, 0x5455, true); // Time (10:34:42)
    lfhView.setUint16(12, 0x5821, true); // Date (2024-01-01)
    lfhView.setUint32(14, entry.crc32, true); // CRC32
    lfhView.setUint32(18, entry.compressedSize, true); // Compressed size
    lfhView.setUint32(22, entry.uncompressedSize, true); // Uncompressed size
    lfhView.setUint16(26, nameBytes.length, true); // Filename length
    lfhView.setUint16(28, extraField.length, true); // Extra field length
    lfh.set(nameBytes, 30);
    lfh.set(extraField, 30 + nameBytes.length);

    parts.push(lfh);
    currentOffset += lfh.length;

    // Payload
    parts.push(entry.data);
    currentOffset += entry.data.length;

    // Sector Alignment Padding (e.g. 4096-byte Unreal DMA alignment)
    const paddingLength = entry.alignmentPadding ?? 0;
    if (paddingLength > 0) {
      const padding = new Uint8Array(paddingLength);
      parts.push(padding);
      currentOffset += paddingLength;
    }

    recordedEntries.push({
      entry,
      nameBytes,
      extraField,
      commentBytes,
      localHeaderOffset,
    });
  }

  // 2. Central Directory
  const centralDirectoryOffset = currentOffset;

  for (const record of recordedEntries) {
    const { entry, nameBytes, extraField, commentBytes, localHeaderOffset } = record;
    // CDFH: 46 bytes + name + extra + comment
    const cdfh = new Uint8Array(46 + nameBytes.length + extraField.length + commentBytes.length);
    const cdfhView = new DataView(cdfh.buffer);
    cdfhView.setUint32(0, 0x02014b50, true); // Central Directory signature
    cdfhView.setUint16(4, 0x0314, true); // Version made by (Unix 2.0)
    cdfhView.setUint16(6, 20, true); // Version needed (2.0)
    cdfhView.setUint16(8, 0, true); // General purpose bit flag
    cdfhView.setUint16(10, entry.compressionMethod, true); // Compression method
    cdfhView.setUint16(12, 0x5455, true); // Time
    cdfhView.setUint16(14, 0x5821, true); // Date
    cdfhView.setUint32(16, entry.crc32, true); // Authoritative CRC32
    cdfhView.setUint32(20, entry.compressedSize, true); // Compressed size
    cdfhView.setUint32(24, entry.uncompressedSize, true); // Uncompressed size
    cdfhView.setUint16(28, nameBytes.length, true); // Filename length
    cdfhView.setUint16(30, extraField.length, true); // Extra field length
    cdfhView.setUint16(32, commentBytes.length, true); // Comment length
    cdfhView.setUint16(34, 0, true); // Disk number start
    cdfhView.setUint16(36, 0, true); // Internal file attributes
    cdfhView.setUint32(38, 0x81a40000, true); // External file attributes (-rw-r--r--)
    cdfhView.setUint32(42, localHeaderOffset, true); // Relative offset of local header

    cdfh.set(nameBytes, 46);
    cdfh.set(extraField, 46 + nameBytes.length);
    cdfh.set(commentBytes, 46 + nameBytes.length + extraField.length);

    parts.push(cdfh);
    currentOffset += cdfh.length;
  }

  const centralDirectorySize = currentOffset - centralDirectoryOffset;

  // 3. End of Central Directory (EOCD: 22 bytes + comment)
  const eocd = new Uint8Array(22 + archiveComment.length);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // Signature
  eocdView.setUint16(4, 0, true); // Disk number
  eocdView.setUint16(6, 0, true); // Start disk
  eocdView.setUint16(8, recordedEntries.length, true); // Entries on this disk
  eocdView.setUint16(10, recordedEntries.length, true); // Total entries
  eocdView.setUint32(12, centralDirectorySize, true); // Central Directory size
  eocdView.setUint32(16, centralDirectoryOffset, true); // Central Directory offset
  eocdView.setUint16(20, archiveComment.length, true); // Comment length
  if (archiveComment.length > 0) {
    eocd.set(archiveComment, 22);
  }

  parts.push(eocd);
  currentOffset += eocd.length;

  // Flatten parts into final container buffer
  const result = new Uint8Array(currentOffset);
  let writeOffset = 0;
  for (const part of parts) {
    result.set(part, writeOffset);
    writeOffset += part.length;
  }

  return {
    bytes: result,
    centralDirectoryOffset,
    centralDirectorySize,
  };
}
