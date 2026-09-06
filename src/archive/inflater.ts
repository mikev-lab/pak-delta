/**
 * Bounded streaming inflation and normalization engine.
 * Inflates compressed slices in bounded 64 KB windows using native Web Standards DecompressionStream
 * with on-the-fly CRC32 and size verification.
 */

import type { ArchiveEntrySlice } from "../types.js";
import type { IBinaryReader } from "./binaryReader.js";
import { createSliceReadableStream, collectChunks, readableStreamToAsyncIterable } from "./streamUtils.js";
import {
  DeflateCorruptionError,
  Crc32MismatchError,
  TruncatedArchiveError,
  UnsupportedCompressionMethodError,
} from "./errors.js";

// IEEE 802.3 bitwise CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Updates a running CRC32 accumulator across streaming chunks.
 */
export function updateCrc32(runningCrc: number, chunk: Uint8Array): number {
  let crc = runningCrc;
  for (let i = 0; i < chunk.length; i++) {
    crc = (CRC_TABLE[(crc ^ chunk[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return crc;
}

/**
 * Creates a native ReadableStream delivering uncompressed entry data in bounded windows.
 */
export function createEntryInflaterStream(
  reader: IBinaryReader,
  slice: ArchiveEntrySlice
): ReadableStream<Uint8Array> {
  if (slice.compressionMethod !== 0 && slice.compressionMethod !== 8) {
    throw new UnsupportedCompressionMethodError(slice.compressionMethod);
  }

  const rawStream = createSliceReadableStream(reader, slice.dataOffset, slice.compressedSize);

  if (slice.compressionMethod === 0) {
    // Stored: stream directly without decompression overhead
    return rawStream;
  }

  // Deflated: pipe through native Web Standards DecompressionStream
  const decompressor = new DecompressionStream("deflate-raw");
  return rawStream.pipeThrough(decompressor);
}

/**
 * Inflates an entry slice into an AsyncIterable of bounded Uint8Array chunks,
 * asserting CRC32 checksum and uncompressed size on the fly.
 */
export async function* inflateEntrySlice(
  reader: IBinaryReader,
  slice: ArchiveEntrySlice
): AsyncIterable<Uint8Array> {
  if (slice.compressionMethod !== 0 && slice.compressionMethod !== 8) {
    throw new UnsupportedCompressionMethodError(slice.compressionMethod);
  }

  let runningCrc = 0xFFFFFFFF;
  let totalBytesRead = 0;

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = createEntryInflaterStream(reader, slice);
  } catch (err) {
    throw err;
  }

  const streamReader = stream.getReader();

  try {
    while (true) {
      let chunk: Uint8Array | undefined;
      let done: boolean | undefined;
      try {
        const res = await streamReader.read();
        chunk = res.value;
        done = res.done;
      } catch (streamErr: unknown) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        throw new DeflateCorruptionError(
          `Decompression failed for entry '${slice.filename}': ${msg}`
        );
      }

      if (done || !chunk) break;

      totalBytesRead += chunk.length;
      runningCrc = updateCrc32(runningCrc, chunk);
      yield chunk;
    }
  } finally {
    streamReader.releaseLock();
  }

  // 1. Validate total uncompressed byte count
  if (totalBytesRead !== slice.uncompressedSize) {
    throw new TruncatedArchiveError(
      `Entry '${slice.filename}' uncompressed size mismatch: expected ${slice.uncompressedSize} bytes, decoded ${totalBytesRead} bytes`
    );
  }

  // 2. Validate final IEEE 802.3 CRC32 checksum
  const finalCrc = (runningCrc ^ 0xFFFFFFFF) >>> 0;
  if (finalCrc !== slice.crc32) {
    throw new Crc32MismatchError(
      `Entry '${slice.filename}' CRC32 mismatch: expected 0x${slice.crc32.toString(16).toUpperCase()}, calculated 0x${finalCrc.toString(16).toUpperCase()}`
    );
  }
}

/**
 * Convenience helper to inflate an entry slice directly into a single Uint8Array buffer.
 * Enforces an explicit maximum memory limit guard (default 64 MB).
 */
export async function inflateEntrySliceToBuffer(
  reader: IBinaryReader,
  slice: ArchiveEntrySlice,
  maxBytes: number = 67108864 // 64 MB memory safety ceiling
): Promise<Uint8Array> {
  if (slice.uncompressedSize > maxBytes) {
    throw new RangeError(
      `Entry '${slice.filename}' uncompressed size (${slice.uncompressedSize} bytes) exceeds maximum buffer limit (${maxBytes} bytes)`
    );
  }
  return collectChunks(inflateEntrySlice(reader, slice), maxBytes);
}
