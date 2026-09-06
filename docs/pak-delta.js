/**
 * pak-delta: In-Browser Client-Side Engine Bundle
 * Archive-aware content-defined delta compression engine with zero external dependencies.
 * Uses native Web Standards: CompressionStream, DecompressionStream, crypto.subtle, Uint8Array, DataView.
 */

// 1. IEEE 802.3 CRC32 Table & Calculator
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCrc32(buffer, seed = 0) {
  let crc = (seed ^ -1) >>> 0;
  for (let i = 0; i < buffer.length; i++) {
    crc = (CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ -1) >>> 0;
}

// 2. SHA-256 Bitwise Functions
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function computeSha256Sync(bytes) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = bytes.length;
  const bitLen = len * 8;
  const kLen = ((len + 8) >> 6) + 1;
  const words = new Uint32Array(kLen * 16);
  for (let i = 0; i < len; i++) {
    words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  }
  words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  words[words.length - 1] = bitLen >>> 0;
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);

  const w = new Int32Array(64);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t];
    for (let t = 16; t < 64; t++) {
      const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
      const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const toHex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

export async function computeSha256(bytes) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return computeSha256Sync(bytes);
}

// 3. FastCDC Gear Table (Deterministic PRNG seed: 0xDEADBEEF)
function initGearTable() {
  const table = new Uint32Array(256);
  let seed = 0xDEADBEEF;
  for (let i = 0; i < 256; i++) {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    table[i] = ((t ^ (t >>> 14)) >>> 0);
  }
  return table;
}
const GEAR_TABLE = initGearTable();

// 4. FastCDC Chunker
export class FastCDCChunker {
  constructor(options = {}) {
    this.minChunkSize = options.minChunkSize ?? 2048;
    this.avgChunkSize = options.avgChunkSize ?? 4096;
    this.maxChunkSize = options.maxChunkSize ?? 16384;
    this.maskStrict = options.maskStrict ?? 0x00007FFF;
    this.maskRelaxed = options.maskRelaxed ?? 0x000007FF;
  }

  chunkBuffer(data, startOffset = 0) {
    const chunks = [];
    const length = data.length;
    let chunkStart = 0;
    let chunkIndex = 0;

    while (chunkStart < length) {
      let cutPoint = length;
      let finger = 0;
      const minPoint = chunkStart + this.minChunkSize;
      const avgPoint = chunkStart + this.avgChunkSize;
      const maxPoint = Math.min(chunkStart + this.maxChunkSize, length);

      let i = minPoint;
      for (; i < avgPoint && i < length; i++) {
        finger = ((finger << 1) + GEAR_TABLE[data[i]]) >>> 0;
        if ((finger & this.maskStrict) === 0) {
          cutPoint = i + 1;
          break;
        }
      }

      if (cutPoint === length && i >= avgPoint) {
        for (; i < maxPoint; i++) {
          finger = ((finger << 1) + GEAR_TABLE[data[i]]) >>> 0;
          if ((finger & this.maskRelaxed) === 0) {
            cutPoint = i + 1;
            break;
          }
        }
      }

      if (cutPoint === length) {
        cutPoint = maxPoint;
      }

      const chunkBytes = data.subarray(chunkStart, cutPoint);
      const chunkHash = computeSha256Sync(chunkBytes);

      chunks.push({
        chunkIndex: chunkIndex++,
        hash: chunkHash,
        offset: startOffset + chunkStart,
        length: chunkBytes.length,
      });

      chunkStart = cutPoint;
    }

    return chunks;
  }
}

// 5. uLEB128 Serialization
export function encodeULEB128(value) {
  const bytes = [];
  let val = Math.floor(value);
  do {
    let byte = val & 0x7F;
    val >>>= 7;
    if (val !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (val !== 0);
  return new Uint8Array(bytes);
}

export function decodeULEB128(buffer, offset) {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;
    result |= (byte & 0x7F) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, bytesRead };
}

// 6. Memory Binary Reader
export class MemoryBinaryReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.size = buffer.length;
  }
  async readAt(offset, length) {
    return this.buffer.subarray(offset, offset + length);
  }
}

// 7. Deflate & Inflate using Web Streams
export async function inflateStream(compressedBytes) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressedBytes);
  writer.close();
  const reader = ds.readable.getReader();
  const parts = [];
  let totalLength = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function deflateStream(uncompressedBytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(uncompressedBytes);
  writer.close();
  const reader = cs.readable.getReader();
  const parts = [];
  let totalLength = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// 8. Container Parsing (EOCD & Central Directory)
export async function parseContainer(reader) {
  const searchWindow = Math.min(reader.size, 65535 + 22);
  const tailBuffer = await reader.readAt(reader.size - searchWindow, searchWindow);
  const tailView = new DataView(tailBuffer.buffer, tailBuffer.byteOffset, tailBuffer.byteLength);

  let eocdOffsetInTail = -1;
  for (let i = tailBuffer.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50) {
      eocdOffsetInTail = i;
      break;
    }
  }
  if (eocdOffsetInTail === -1) {
    throw new Error("ERR_INVALID_ARCHIVE_HEADER: EOCD signature not found");
  }

  const cdTotalEntries = tailView.getUint16(eocdOffsetInTail + 10, true);
  const cdSize = tailView.getUint32(eocdOffsetInTail + 12, true);
  const cdOffset = tailView.getUint32(eocdOffsetInTail + 16, true);
  const commentLength = tailView.getUint16(eocdOffsetInTail + 20, true);

  const cdBuffer = await reader.readAt(cdOffset, cdSize);
  const cdView = new DataView(cdBuffer.buffer, cdBuffer.byteOffset, cdBuffer.byteLength);
  const entries = [];
  let cur = 0;
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < cdTotalEntries; i++) {
    if (cur + 46 > cdBuffer.length) break;
    if (cdView.getUint32(cur, true) !== 0x02014b50) break;

    const bitFlag = cdView.getUint16(cur + 8, true);
    const method = cdView.getUint16(cur + 10, true);
    const crc32 = cdView.getUint32(cur + 16, true);
    const compressedSize = cdView.getUint32(cur + 20, true);
    const uncompressedSize = cdView.getUint32(cur + 24, true);
    const nameLen = cdView.getUint16(cur + 28, true);
    const extraLen = cdView.getUint16(cur + 30, true);
    const commentLen = cdView.getUint16(cur + 32, true);
    const localHeaderOffset = cdView.getUint32(cur + 42, true);

    const nameBytes = cdBuffer.subarray(cur + 46, cur + 46 + nameLen);
    const filename = decoder.decode(nameBytes);

    entries.push({
      filename,
      compressionMethod: method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      extraFieldLength: extraLen,
      commentLength: commentLen,
      bitFlag,
    });

    cur += 46 + nameLen + extraLen + commentLen;
  }

  // Parse slices & local headers to get exact payload offsets and alignment padding
  const slices = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const lfhHeaderBytes = await reader.readAt(entry.localHeaderOffset, 30);
    const lfhView = new DataView(lfhHeaderBytes.buffer, lfhHeaderBytes.byteOffset, 30);
    const lfhNameLen = lfhView.getUint16(26, true);
    const lfhExtraLen = lfhView.getUint16(28, true);
    const payloadOffset = entry.localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;

    let alignmentPadding = 0;
    if (i + 1 < entries.length) {
      alignmentPadding = entries[i + 1].localHeaderOffset - (payloadOffset + entry.compressedSize);
    } else {
      alignmentPadding = cdOffset - (payloadOffset + entry.compressedSize);
    }
    if (alignmentPadding < 0) alignmentPadding = 0;

    slices.push({
      filename: entry.filename,
      compressionMethod: entry.compressionMethod,
      crc32: entry.crc32,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      localHeaderOffset: entry.localHeaderOffset,
      payloadOffset,
      alignmentPadding,
    });
  }

  const archiveSha256 = await computeSha256(await reader.readAt(0, reader.size));

  return {
    archiveSha256,
    totalEntries: cdTotalEntries,
    centralDirectoryOffset: cdOffset,
    centralDirectorySize: cdSize,
    commentLength,
    slices,
  };
}

// 9. Sub-Chunk Span Delta
export function computeSubChunkSpanDelta(baseChunk, targetChunk) {
  const minLen = Math.min(baseChunk.length, targetChunk.length);
  const spans = [];
  let i = 0;

  while (i < minLen) {
    if (baseChunk[i] !== targetChunk[i]) {
      const spanStart = i;
      while (i < minLen && baseChunk[i] !== targetChunk[i]) {
        i++;
      }
      const spanLen = i - spanStart;
      spans.push({
        offset: spanStart,
        length: spanLen,
        replacementBytes: targetChunk.subarray(spanStart, spanStart + spanLen),
      });
    } else {
      i++;
    }
  }

  if (targetChunk.length > minLen) {
    spans.push({
      offset: minLen,
      length: targetChunk.length - minLen,
      replacementBytes: targetChunk.subarray(minLen),
    });
  }

  let totalDiff = spans.reduce((sum, s) => sum + s.length, 0);
  const similarity = 1 - (totalDiff / Math.max(baseChunk.length, targetChunk.length));

  // Serialize span delta
  const parts = [];
  parts.push(encodeULEB128(spans.length));
  for (const span of spans) {
    parts.push(encodeULEB128(span.offset));
    parts.push(encodeULEB128(span.length));
    parts.push(span.replacementBytes);
  }

  let totalBytes = 0;
  for (const p of parts) totalBytes += p.length;
  const deltaBytes = new Uint8Array(totalBytes);
  let w = 0;
  for (const p of parts) {
    deltaBytes.set(p, w);
    w += p.length;
  }

  return { similarity, deltaBytes };
}

export function applySubChunkSpanDelta(baseChunk, deltaBytes) {
  let off = 0;
  const countDec = decodeULEB128(deltaBytes, off);
  const spanCount = countDec.value;
  off += countDec.bytesRead;

  // Clone base chunk to allow mutation
  let result = new Uint8Array(baseChunk);
  for (let i = 0; i < spanCount; i++) {
    const sOffDec = decodeULEB128(deltaBytes, off);
    const spanOffset = sOffDec.value;
    off += sOffDec.bytesRead;

    const sLenDec = decodeULEB128(deltaBytes, off);
    const spanLength = sLenDec.value;
    off += sLenDec.bytesRead;

    const replacement = deltaBytes.subarray(off, off + spanLength);
    off += spanLength;

    if (spanOffset + spanLength > result.length) {
      const expanded = new Uint8Array(spanOffset + spanLength);
      expanded.set(result, 0);
      result = expanded;
    }
    result.set(replacement, spanOffset);
  }
  return result;
}

// 10. Delta Pipeline: Create Delta Manifest
export async function createDeltaManifest(sourceBytes, targetBytes) {
  const srcReader = new MemoryBinaryReader(sourceBytes);
  const tgtReader = new MemoryBinaryReader(targetBytes);

  const srcIndex = await parseContainer(srcReader);
  const tgtIndex = await parseContainer(tgtReader);

  const chunker = new FastCDCChunker({
    minChunkSize: 2048,
    avgChunkSize: 4096,
    maxChunkSize: 16384,
  });

  // Extract source uncompressed stream and index chunks
  const srcChunkMap = new Map();
  const srcUncompressedBuffers = [];
  let srcTotalUncompressed = 0;

  for (const slice of srcIndex.slices) {
    const rawCompressed = await srcReader.readAt(slice.payloadOffset, slice.compressedSize);
    const uncompressed = slice.compressionMethod === 8 ? await inflateStream(rawCompressed) : rawCompressed;
    const streamOffset = srcTotalUncompressed;
    srcUncompressedBuffers.push({ offset: streamOffset, data: uncompressed });
    srcTotalUncompressed += uncompressed.length;

    const chunks = chunker.chunkBuffer(uncompressed, streamOffset);
    for (const chunk of chunks) {
      if (!srcChunkMap.has(chunk.hash)) {
        srcChunkMap.set(chunk.hash, chunk);
      }
    }
  }

  // Process target slices
  const payloadParts = [];
  let payloadOffset = 0;
  const entries = [];
  let targetTotalUncompressedBytes = 0;

  for (let i = 0; i < tgtIndex.slices.length; i++) {
    const tgtSlice = tgtIndex.slices[i];
    const rawCompressed = await tgtReader.readAt(tgtSlice.payloadOffset, tgtSlice.compressedSize);
    const uncompressed = tgtSlice.compressionMethod === 8 ? await inflateStream(rawCompressed) : rawCompressed;
    targetTotalUncompressedBytes += uncompressed.length;

    const targetChunks = chunker.chunkBuffer(uncompressed, 0);
    const opcodes = [];

    for (let cIdx = 0; cIdx < targetChunks.length; cIdx++) {
      const tChunk = targetChunks[cIdx];
      const tChunkBytes = uncompressed.subarray(tChunk.offset, tChunk.offset + tChunk.length);

      // Case A: 100% Chunk Match
      if (srcChunkMap.has(tChunk.hash)) {
        const matched = srcChunkMap.get(tChunk.hash);
        opcodes.push({
          type: "COPY",
          sourceOffset: matched.offset,
          length: matched.length,
          chunkHash: matched.hash,
        });
        continue;
      }

      // Case B: Check similarity against candidate chunk for PATCH
      let patchEmitted = false;
      // Look for candidate chunk at same position in source slice if available
      if (i < srcIndex.slices.length) {
        const candidateBuf = srcUncompressedBuffers[i]?.data;
        if (candidateBuf && tChunk.offset < candidateBuf.length) {
          const baseCand = candidateBuf.subarray(tChunk.offset, Math.min(candidateBuf.length, tChunk.offset + tChunk.length));
          const { similarity, deltaBytes } = computeSubChunkSpanDelta(baseCand, tChunkBytes);
          if (similarity >= 0.70 && deltaBytes.length < tChunkBytes.length * 0.75) {
            const curPayloadOffset = payloadOffset;
            payloadParts.push(deltaBytes);
            payloadOffset += deltaBytes.length;

            opcodes.push({
              type: "PATCH",
              sourceOffset: srcUncompressedBuffers[i].offset + tChunk.offset,
              length: baseCand.length,
              chunkHash: tChunk.hash,
              deltaOffset: curPayloadOffset,
              deltaLength: deltaBytes.length,
            });
            patchEmitted = true;
          }
        }
      }

      // Case C: Novel INSERT
      if (!patchEmitted) {
        const curPayloadOffset = payloadOffset;
        payloadParts.push(tChunkBytes);
        payloadOffset += tChunkBytes.length;

        opcodes.push({
          type: "INSERT",
          length: tChunkBytes.length,
          chunkHash: tChunk.hash,
          payloadOffset: curPayloadOffset,
        });
      }
    }

    entries.push({
      filename: tgtSlice.filename,
      compressionMethod: tgtSlice.compressionMethod,
      repackMode: "standard",
      uncompressedSize: tgtSlice.uncompressedSize,
      compressedSize: tgtSlice.compressedSize,
      crc32: tgtSlice.crc32,
      alignmentPadding: tgtSlice.alignmentPadding,
      opcodes,
    });
  }

  // Flatten payload pool
  const rawPayloadPool = new Uint8Array(payloadOffset);
  let curP = 0;
  for (const part of payloadParts) {
    rawPayloadPool.set(part, curP);
    curP += part.length;
  }

  return {
    magic: "PAKD",
    version: "1.0.0",
    sourceArchiveSha256: srcIndex.archiveSha256,
    targetArchiveSha256: tgtIndex.archiveSha256,
    targetTotalUncompressedBytes,
    entries,
    rawPayloadPool,
  };
}

// 11. Manifest Binary Serializer & Deserializer
export function serializeManifest(manifest) {
  const parts = [];
  // Magic: 'PAKD'
  parts.push(new Uint8Array([0x50, 0x41, 0x4B, 0x44]));
  // Version: 1
  parts.push(new Uint8Array([0x01]));
  // Flags: 0
  parts.push(new Uint8Array([0x00]));

  // Source & Target SHA-256 (32 bytes each)
  const hexToBytes = (hex) => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  };
  parts.push(hexToBytes(manifest.sourceArchiveSha256));
  parts.push(hexToBytes(manifest.targetArchiveSha256));
  parts.push(encodeULEB128(manifest.targetTotalUncompressedBytes));

  // Build unique chunk hash dictionary
  const hashDict = [];
  const hashIndexMap = new Map();
  for (const entry of manifest.entries) {
    for (const op of entry.opcodes) {
      if (!hashIndexMap.has(op.chunkHash)) {
        hashIndexMap.set(op.chunkHash, hashDict.length);
        hashDict.push(op.chunkHash);
      }
    }
  }

  parts.push(encodeULEB128(hashDict.length));
  for (const h of hashDict) {
    parts.push(hexToBytes(h));
  }

  parts.push(encodeULEB128(manifest.entries.length));
  const encoder = new TextEncoder();

  for (const entry of manifest.entries) {
    const nameBytes = encoder.encode(entry.filename);
    parts.push(encodeULEB128(nameBytes.length));
    parts.push(nameBytes);
    parts.push(new Uint8Array([entry.compressionMethod & 0xFF]));
    parts.push(new Uint8Array([entry.repackMode === "bit_preserving" ? 1 : 0]));
    parts.push(encodeULEB128(entry.uncompressedSize));
    parts.push(encodeULEB128(entry.compressedSize));

    const crcBuf = new Uint8Array(4);
    new DataView(crcBuf.buffer).setUint32(0, entry.crc32, true);
    parts.push(crcBuf);

    parts.push(encodeULEB128(entry.alignmentPadding));
    parts.push(encodeULEB128(entry.opcodes.length));

    for (const op of entry.opcodes) {
      const dictIdx = hashIndexMap.get(op.chunkHash) ?? 0;
      if (op.type === "COPY") {
        parts.push(new Uint8Array([0x00]));
        parts.push(encodeULEB128(op.sourceOffset));
        parts.push(encodeULEB128(op.length));
        parts.push(encodeULEB128(dictIdx));
      } else if (op.type === "PATCH") {
        parts.push(new Uint8Array([0x01]));
        parts.push(encodeULEB128(op.sourceOffset));
        parts.push(encodeULEB128(op.length));
        parts.push(encodeULEB128(dictIdx));
        parts.push(encodeULEB128(op.deltaOffset));
        parts.push(encodeULEB128(op.deltaLength));
      } else {
        parts.push(new Uint8Array([0x02]));
        parts.push(encodeULEB128(op.payloadOffset));
        parts.push(encodeULEB128(op.length));
        parts.push(encodeULEB128(dictIdx));
      }
    }
  }

  parts.push(encodeULEB128(manifest.rawPayloadPool.length));
  parts.push(manifest.rawPayloadPool);

  let totalSize = 0;
  for (const p of parts) totalSize += p.length;
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

export function deserializeManifest(bytes) {
  let off = 0;
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== "PAKD") {
    throw new Error("ERR_MANIFEST_CORRUPT: Invalid PAKD magic bytes");
  }
  off += 4;
  const version = bytes[off++];
  const flags = bytes[off++];

  const bytesToHex = (buf) => Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
  const srcSha = bytesToHex(bytes.subarray(off, off + 32));
  off += 32;
  const tgtSha = bytesToHex(bytes.subarray(off, off + 32));
  off += 32;

  const tgtBytesDec = decodeULEB128(bytes, off);
  const targetTotalUncompressedBytes = tgtBytesDec.value;
  off += tgtBytesDec.bytesRead;

  const dictCountDec = decodeULEB128(bytes, off);
  const dictCount = dictCountDec.value;
  off += dictCountDec.bytesRead;

  const hashDict = [];
  for (let i = 0; i < dictCount; i++) {
    hashDict.push(bytesToHex(bytes.subarray(off, off + 32)));
    off += 32;
  }

  const entryCountDec = decodeULEB128(bytes, off);
  const entryCount = entryCountDec.value;
  off += entryCountDec.bytesRead;

  const entries = [];
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < entryCount; i++) {
    const nameLenDec = decodeULEB128(bytes, off);
    off += nameLenDec.bytesRead;
    const filename = decoder.decode(bytes.subarray(off, off + nameLenDec.value));
    off += nameLenDec.value;

    const compressionMethod = bytes[off++];
    const repackMode = bytes[off++] === 1 ? "bit_preserving" : "standard";

    const uSizeDec = decodeULEB128(bytes, off);
    off += uSizeDec.bytesRead;
    const uncompressedSize = uSizeDec.value;

    const cSizeDec = decodeULEB128(bytes, off);
    off += cSizeDec.bytesRead;
    const compressedSize = cSizeDec.value;

    const crcView = new DataView(bytes.buffer, bytes.byteOffset + off, 4);
    const crc32 = crcView.getUint32(0, true);
    off += 4;

    const alignDec = decodeULEB128(bytes, off);
    off += alignDec.bytesRead;
    const alignmentPadding = alignDec.value;

    const opCountDec = decodeULEB128(bytes, off);
    off += opCountDec.bytesRead;
    const opCount = opCountDec.value;

    const opcodes = [];
    for (let o = 0; o < opCount; o++) {
      const tag = bytes[off++];
      if (tag === 0x00) {
        const sOffDec = decodeULEB128(bytes, off);
        off += sOffDec.bytesRead;
        const lenDec = decodeULEB128(bytes, off);
        off += lenDec.bytesRead;
        const dIdxDec = decodeULEB128(bytes, off);
        off += dIdxDec.bytesRead;
        opcodes.push({
          type: "COPY",
          sourceOffset: sOffDec.value,
          length: lenDec.value,
          chunkHash: hashDict[dIdxDec.value],
        });
      } else if (tag === 0x01) {
        const sOffDec = decodeULEB128(bytes, off);
        off += sOffDec.bytesRead;
        const lenDec = decodeULEB128(bytes, off);
        off += lenDec.bytesRead;
        const dIdxDec = decodeULEB128(bytes, off);
        off += dIdxDec.bytesRead;
        const pOffDec = decodeULEB128(bytes, off);
        off += pOffDec.bytesRead;
        const pLenDec = decodeULEB128(bytes, off);
        off += pLenDec.bytesRead;
        opcodes.push({
          type: "PATCH",
          sourceOffset: sOffDec.value,
          length: lenDec.value,
          chunkHash: hashDict[dIdxDec.value],
          deltaOffset: pOffDec.value,
          deltaLength: pLenDec.value,
        });
      } else {
        const pOffDec = decodeULEB128(bytes, off);
        off += pOffDec.bytesRead;
        const lenDec = decodeULEB128(bytes, off);
        off += lenDec.bytesRead;
        const dIdxDec = decodeULEB128(bytes, off);
        off += dIdxDec.bytesRead;
        opcodes.push({
          type: "INSERT",
          payloadOffset: pOffDec.value,
          length: lenDec.value,
          chunkHash: hashDict[dIdxDec.value],
        });
      }
    }

    entries.push({
      filename,
      compressionMethod,
      repackMode,
      uncompressedSize,
      compressedSize,
      crc32,
      alignmentPadding,
      opcodes,
    });
  }

  const poolLenDec = decodeULEB128(bytes, off);
  off += poolLenDec.bytesRead;
  const rawPayloadPool = bytes.subarray(off, off + poolLenDec.value);

  return {
    magic: "PAKD",
    version: "1.0.0",
    sourceArchiveSha256: srcSha,
    targetArchiveSha256: tgtSha,
    targetTotalUncompressedBytes,
    entries,
    rawPayloadPool,
  };
}

// 12. Reconstitution Assembler
export async function applyDelta(sourceBytes, deltaInput) {
  const manifest = deltaInput instanceof Uint8Array ? deserializeManifest(deltaInput) : deltaInput;
  const srcReader = new MemoryBinaryReader(sourceBytes);
  const srcIndex = await parseContainer(srcReader);

  if (srcIndex.archiveSha256 !== manifest.sourceArchiveSha256) {
    throw new Error(`ERR_BASELINE_SHA256_MISMATCH: Expected baseline ${manifest.sourceArchiveSha256}, but got ${srcIndex.archiveSha256}`);
  }

  // Extract source uncompressed stream to fulfill COPY opcodes
  const srcUncompressedStream = [];
  let srcStreamLen = 0;
  for (const slice of srcIndex.slices) {
    const rawCompressed = await srcReader.readAt(slice.payloadOffset, slice.compressedSize);
    const uncompressed = slice.compressionMethod === 8 ? await inflateStream(rawCompressed) : rawCompressed;
    srcUncompressedStream.push(uncompressed);
    srcStreamLen += uncompressed.length;
  }
  const sourceFlatStream = new Uint8Array(srcStreamLen);
  let srcW = 0;
  for (const part of srcUncompressedStream) {
    sourceFlatStream.set(part, srcW);
    srcW += part.length;
  }

  // Reconstitute entries
  const localRecords = [];
  const cdRecords = [];
  let currentOffset = 0;
  const encoder = new TextEncoder();

  for (const entry of manifest.entries) {
    // 1. Assemble uncompressed entry payload from opcodes
    const chunkParts = [];
    let entryUncompressedLen = 0;

    for (const op of entry.opcodes) {
      let chunkData;
      if (op.type === "COPY") {
        chunkData = sourceFlatStream.subarray(op.sourceOffset, op.sourceOffset + op.length);
      } else if (op.type === "PATCH") {
        const baseChunk = sourceFlatStream.subarray(op.sourceOffset, op.sourceOffset + op.length);
        const deltaBytes = manifest.rawPayloadPool.subarray(op.deltaOffset, op.deltaOffset + op.deltaLength);
        chunkData = applySubChunkSpanDelta(baseChunk, deltaBytes);
      } else {
        chunkData = manifest.rawPayloadPool.subarray(op.payloadOffset, op.payloadOffset + op.length);
      }

      const chunkHash = computeSha256Sync(chunkData);
      if (chunkHash !== op.chunkHash) {
        throw new Error(`ERR_CHUNK_HASH_MISMATCH: Opcode chunk hash mismatch for entry ${entry.filename}`);
      }

      chunkParts.push(chunkData);
      entryUncompressedLen += chunkData.length;
    }

    const uncompressedEntry = new Uint8Array(entryUncompressedLen);
    let uOff = 0;
    for (const part of chunkParts) {
      uncompressedEntry.set(part, uOff);
      uOff += part.length;
    }

    // Verify uncompressed CRC32
    const calculatedCrc = computeCrc32(uncompressedEntry);
    if (calculatedCrc !== entry.crc32) {
      throw new Error(`ERR_ENTRY_CRC32_MISMATCH: CRC32 mismatch for ${entry.filename}`);
    }

    // Compress payload
    let compressedPayload;
    if (entry.compressionMethod === 8) {
      compressedPayload = await deflateStream(uncompressedEntry);
    } else {
      compressedPayload = uncompressedEntry;
    }

    const nameBytes = encoder.encode(entry.filename);
    const localHeaderOffset = currentOffset;

    // Build Local File Header
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(6, 0, true);
    lfhView.setUint16(8, entry.compressionMethod, true);
    lfhView.setUint16(10, 0x5455, true);
    lfhView.setUint16(12, 0x5821, true);
    lfhView.setUint32(14, entry.crc32, true);
    lfhView.setUint32(18, compressedPayload.length, true);
    lfhView.setUint32(22, entry.uncompressedSize, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfhView.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    localRecords.push(lfh);
    currentOffset += lfh.length;

    localRecords.push(compressedPayload);
    currentOffset += compressedPayload.length;

    // Alignment padding
    if (entry.alignmentPadding > 0) {
      const padding = new Uint8Array(entry.alignmentPadding);
      localRecords.push(padding);
      currentOffset += entry.alignmentPadding;
    }

    // Build Central Directory File Header
    const cdfh = new Uint8Array(46 + nameBytes.length);
    const cdfhView = new DataView(cdfh.buffer);
    cdfhView.setUint32(0, 0x02014b50, true);
    cdfhView.setUint16(4, 0x0314, true);
    cdfhView.setUint16(6, 20, true);
    cdfhView.setUint16(8, 0, true);
    cdfhView.setUint16(10, entry.compressionMethod, true);
    cdfhView.setUint16(12, 0x5455, true);
    cdfhView.setUint16(14, 0x5821, true);
    cdfhView.setUint32(16, entry.crc32, true);
    cdfhView.setUint32(20, compressedPayload.length, true);
    cdfhView.setUint32(24, entry.uncompressedSize, true);
    cdfhView.setUint16(28, nameBytes.length, true);
    cdfhView.setUint16(30, 0, true);
    cdfhView.setUint16(32, 0, true);
    cdfhView.setUint16(34, 0, true);
    cdfhView.setUint16(36, 0, true);
    cdfhView.setUint32(38, 0x81A40000, true);
    cdfhView.setUint32(42, localHeaderOffset, true);
    cdfh.set(nameBytes, 46);

    cdRecords.push(cdfh);
  }

  const centralDirectoryOffset = currentOffset;
  let cdSize = 0;
  for (const r of cdRecords) cdSize += r.length;

  // Build EOCD
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, manifest.entries.length, true);
  eocdView.setUint16(10, manifest.entries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);
  eocdView.setUint16(20, 0, true);

  // Assemble full archive
  const totalArchiveSize = currentOffset + cdSize + 22;
  const reconstitutedArchive = new Uint8Array(totalArchiveSize);
  let writeOffset = 0;

  for (const part of localRecords) {
    reconstitutedArchive.set(part, writeOffset);
    writeOffset += part.length;
  }
  for (const cdfh of cdRecords) {
    reconstitutedArchive.set(cdfh, writeOffset);
    writeOffset += cdfh.length;
  }
  reconstitutedArchive.set(eocd, writeOffset);

  // Final validation: Assert target SHA-256
  const finalSha256 = await computeSha256(reconstitutedArchive);
  if (finalSha256 !== manifest.targetArchiveSha256) {
    throw new Error(`ERR_TARGET_SHA256_MISMATCH: Target archive SHA-256 mismatch. Expected ${manifest.targetArchiveSha256}, got ${finalSha256}`);
  }

  return reconstitutedArchive;
}

// 13. Top-Level Facade
export async function createDelta(sourceBytes, targetBytes) {
  const manifest = await createDeltaManifest(sourceBytes, targetBytes);
  return serializeManifest(manifest);
}

// 14. Procedural Synthetic Archive Generator for Browser Testing
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createProceduralAsset(type, size, seed) {
  const rng = mulberry32(seed);
  const buffer = new Uint8Array(size);
  if (type === "texture") {
    for (let i = 0; i < size; i++) {
      const x = i % 256;
      const y = Math.floor(i / 256) % 256;
      buffer[i] = (x ^ y ^ Math.floor(rng() * 16)) & 0xFF;
    }
  } else if (type === "audio") {
    for (let i = 0; i < size; i += 2) {
      const sample = Math.sin(i * 0.05) * 30000;
      const intSample = Math.floor(sample) & 0xFFFF;
      buffer[i] = intSample & 0xFF;
      if (i + 1 < size) buffer[i + 1] = (intSample >>> 8) & 0xFF;
    }
  } else {
    for (let i = 0; i < size; i++) {
      buffer[i] = Math.floor(rng() * 256);
    }
  }
  return buffer;
}

export async function buildSyntheticArchive(entries, sectorAlignment = 0) {
  const records = [];
  const parts = [];
  let currentOffset = 0;
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const isCompressed = entry.compressed !== false;
    const method = isCompressed ? 8 : 0;
    const crc = computeCrc32(entry.data);
    const compressedData = isCompressed ? await deflateStream(entry.data) : entry.data;
    const nameBytes = encoder.encode(entry.name);

    const localHeaderOffset = currentOffset;
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(6, 0, true);
    lfhView.setUint16(8, method, true);
    lfhView.setUint16(10, 0x5455, true);
    lfhView.setUint16(12, 0x5821, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, compressedData.length, true);
    lfhView.setUint32(22, entry.data.length, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfhView.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    parts.push(lfh);
    currentOffset += lfh.length;

    parts.push(compressedData);
    currentOffset += compressedData.length;

    let paddingBytes = 0;
    if (sectorAlignment > 0) {
      const rem = currentOffset % sectorAlignment;
      if (rem !== 0) {
        paddingBytes = sectorAlignment - rem;
        parts.push(new Uint8Array(paddingBytes));
        currentOffset += paddingBytes;
      }
    }

    records.push({
      name: entry.name,
      data: entry.data,
      method,
      crc,
      compressedSize: compressedData.length,
      uncompressedSize: entry.data.length,
      localHeaderOffset,
      alignmentPadding: paddingBytes,
    });
  }

  const centralDirectoryOffset = currentOffset;
  for (const record of records) {
    const nameBytes = encoder.encode(record.name);
    const cdfh = new Uint8Array(46 + nameBytes.length);
    const cdfhView = new DataView(cdfh.buffer);
    cdfhView.setUint32(0, 0x02014b50, true);
    cdfhView.setUint16(4, 0x0314, true);
    cdfhView.setUint16(6, 20, true);
    cdfhView.setUint16(8, 0, true);
    cdfhView.setUint16(10, record.method, true);
    cdfhView.setUint16(12, 0x5455, true);
    cdfhView.setUint16(14, 0x5821, true);
    cdfhView.setUint32(16, record.crc, true);
    cdfhView.setUint32(20, record.compressedSize, true);
    cdfhView.setUint32(24, record.uncompressedSize, true);
    cdfhView.setUint16(28, nameBytes.length, true);
    cdfhView.setUint16(30, 0, true);
    cdfhView.setUint16(32, 0, true);
    cdfhView.setUint16(34, 0, true);
    cdfhView.setUint16(36, 0, true);
    cdfhView.setUint32(38, 0x81A40000, true);
    cdfhView.setUint32(42, record.localHeaderOffset, true);
    cdfh.set(nameBytes, 46);

    parts.push(cdfh);
    currentOffset += cdfh.length;
  }

  const cdSize = currentOffset - centralDirectoryOffset;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, records.length, true);
  eocdView.setUint16(10, records.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);
  eocdView.setUint16(20, 0, true);

  parts.push(eocd);
  currentOffset += eocd.length;

  const result = new Uint8Array(currentOffset);
  let w = 0;
  for (const p of parts) {
    result.set(p, w);
    w += p.length;
  }
  return result;
}
