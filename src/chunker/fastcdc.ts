/**
 * FastCDC (Fast Content-Defined Chunking) Engine.
 * Implements 32-bit gear hash rolling window with dual-threshold normalized masking,
 * pathological input clamping, and streaming carry-over buffers.
 */

import { GEAR_TABLE } from "./table.js";
import { computeChunkHashSync } from "./fingerprint.js";

export interface FastCdcOptions {
  minSize?: number; // Minimum chunk size (default: 2048 / 2 KB)
  avgSize?: number; // Target average chunk size (default: 8192 / 8 KB)
  maxSize?: number; // Maximum chunk size clamp (default: 32768 / 32 KB)
  maskStrict?: number; // Strict cut mask between minSize and avgSize (default: 0x00007FFF)
  maskRelaxed?: number; // Relaxed cut mask between avgSize and maxSize (default: 0x000007FF)
  emitPayload?: boolean; // Whether to attach chunk payload bytes (default: false)
}

export interface ChunkBoundary {
  index: number;
  offset: number; // Entry-relative uncompressed byte offset
  length: number; // Chunk byte length
  hash: string; // 64-character lowercase hex SHA-256
  data?: Uint8Array; // Optional chunk payload bytes
}

export const DEFAULT_FASTCDC_OPTIONS: Required<FastCdcOptions> = {
  minSize: 2048,
  avgSize: 8192,
  maxSize: 32768,
  maskStrict: 0x00007FFF,
  maskRelaxed: 0x000007FF,
  emitPayload: false,
};

/**
 * Combines an array of Uint8Array slices into a single contiguous Uint8Array.
 */
function concatenateSlices(slices: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const s of slices) {
    result.set(s, offset);
    offset += s.length;
  }
  return result;
}

/**
 * Chunks a streaming AsyncIterable of Uint8Array buffers using FastCDC.
 * Emits ChunkBoundary records with 100% boundary invariance across arbitrary stream fragments.
 */
export async function* chunkStream(
  stream: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  options?: FastCdcOptions
): AsyncIterable<ChunkBoundary> {
  const minSize = options?.minSize ?? DEFAULT_FASTCDC_OPTIONS.minSize;
  const avgSize = options?.avgSize ?? DEFAULT_FASTCDC_OPTIONS.avgSize;
  const maxSize = options?.maxSize ?? DEFAULT_FASTCDC_OPTIONS.maxSize;
  const maskStrict = options?.maskStrict ?? DEFAULT_FASTCDC_OPTIONS.maskStrict;
  const maskRelaxed = options?.maskRelaxed ?? DEFAULT_FASTCDC_OPTIONS.maskRelaxed;
  const emitPayload = options?.emitPayload ?? DEFAULT_FASTCDC_OPTIONS.emitPayload;

  let chunkIndex = 0;
  let globalOffset = 0;
  let currentChunkLength = 0;
  let rollingHash = 0;

  // Carried over slices for the active chunk spanning previous stream fragments
  const carrySlices: Uint8Array[] = [];
  let carryLength = 0;

  for await (const buffer of stream) {
    if (buffer.length === 0) continue;

    let sliceStartInBuf = 0;

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      currentChunkLength++;
      rollingHash = ((rollingHash << 1) + GEAR_TABLE[byte]) >>> 0;

      let isCut = false;

      if (currentChunkLength < minSize) {
        // Below minimum size: never cut
        isCut = false;
      } else if (currentChunkLength < avgSize) {
        // Phase 1: strict mask between min and avg
        if ((rollingHash & maskStrict) === 0) {
          isCut = true;
        }
      } else if (currentChunkLength < maxSize) {
        // Phase 2: relaxed mask between avg and max
        if ((rollingHash & maskRelaxed) === 0) {
          isCut = true;
        }
      } else {
        // Phase 3: hard upper bound clamp at maxSize (pathological protection)
        isCut = true;
      }

      if (isCut) {
        const sliceFromBuf = buffer.subarray(sliceStartInBuf, i + 1);
        let chunkBytes: Uint8Array;

        if (carrySlices.length > 0) {
          carrySlices.push(sliceFromBuf);
          carryLength += sliceFromBuf.length;
          chunkBytes = concatenateSlices(carrySlices, carryLength);
          carrySlices.length = 0;
          carryLength = 0;
        } else {
          chunkBytes = sliceFromBuf;
        }

        const chunkHash = computeChunkHashSync(chunkBytes);

        yield {
          index: chunkIndex++,
          offset: globalOffset,
          length: chunkBytes.length,
          hash: chunkHash,
          data: emitPayload ? chunkBytes : undefined,
        };

        globalOffset += chunkBytes.length;
        currentChunkLength = 0;
        rollingHash = 0;
        sliceStartInBuf = i + 1;
      }
    }

    // Accumulate any remaining un-cut bytes at the end of the buffer into carry buffer
    if (sliceStartInBuf < buffer.length) {
      const remainingSlice = buffer.subarray(sliceStartInBuf);
      carrySlices.push(remainingSlice);
      carryLength += remainingSlice.length;
    }
  }

  // Emit final terminal chunk if remaining bytes exist
  if (carryLength > 0) {
    const chunkBytes = carrySlices.length === 1 ? carrySlices[0] : concatenateSlices(carrySlices, carryLength);
    const chunkHash = computeChunkHashSync(chunkBytes);

    yield {
      index: chunkIndex++,
      offset: globalOffset,
      length: chunkBytes.length,
      hash: chunkHash,
      data: emitPayload ? chunkBytes : undefined,
    };

    globalOffset += chunkBytes.length;
  }
}

/**
 * Convenience helper to chunk a contiguous in-memory Uint8Array buffer.
 */
export async function chunkBuffer(
  buffer: Uint8Array,
  options?: FastCdcOptions
): Promise<ChunkBoundary[]> {
  const chunks: ChunkBoundary[] = [];
  for await (const chunk of chunkStream([buffer], options)) {
    chunks.push(chunk);
  }
  return chunks;
}
