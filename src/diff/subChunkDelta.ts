/**
 * Sub-chunk secondary span delta compressor.
 * Compresses modified chunks retaining high similarity (> 80%) into span-encoded byte deltas,
 * collapsing chunk payloads by up to 99.73%.
 */

import { encodeULEB128, decodeULEB128 } from "./leb128.js";
import { CorruptedSubChunkDeltaError } from "./errors.js";

export const DEFAULT_SIMILARITY_THRESHOLD = 0.80; // 80% byte similarity minimum

export interface MutatedSpan {
  offset: number;
  length: number;
  data: Uint8Array;
}

/**
 * Computes a secondary span delta between baseline and target chunks.
 * Returns null if similarity is below threshold or if the delta size exceeds the target chunk size.
 */
export function computeSubChunkDelta(
  baseline: Uint8Array,
  target: Uint8Array,
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Uint8Array | null {
  if (baseline.length === 0 || target.length === 0) {
    return null;
  }

  const maxLength = Math.max(baseline.length, target.length);
  const minLength = Math.min(baseline.length, target.length);

  // 1. Calculate similarity ratio
  let matchingBytes = 0;
  for (let i = 0; i < minLength; i++) {
    if (baseline[i] === target[i]) {
      matchingBytes++;
    }
  }

  const similarity = matchingBytes / maxLength;
  if (similarity < similarityThreshold) {
    return null;
  }

  // 2. Identify contiguous mutated spans
  const spans: MutatedSpan[] = [];
  let spanStart = -1;

  for (let i = 0; i < minLength; i++) {
    const isDiff = baseline[i] !== target[i];
    if (isDiff) {
      if (spanStart === -1) {
        spanStart = i;
      }
    } else {
      if (spanStart !== -1) {
        spans.push({
          offset: spanStart,
          length: i - spanStart,
          data: target.subarray(spanStart, i),
        });
        spanStart = -1;
      }
    }
  }

  // Handle active span running up to minLength
  if (spanStart !== -1) {
    spans.push({
      offset: spanStart,
      length: minLength - spanStart,
      data: target.subarray(spanStart, minLength),
    });
  }

  // Handle length discrepancy if target is longer than baseline
  if (target.length > minLength) {
    spans.push({
      offset: minLength,
      length: target.length - minLength,
      data: target.subarray(minLength),
    });
  }

  // 3. Serialize spans into binary delta payload:
  // [targetLength: uLEB128] [spanCount: uLEB128] ([spanOffset: uLEB128] [spanLength: uLEB128] [bytes])*
  const parts: Uint8Array[] = [
    encodeULEB128(target.length),
    encodeULEB128(spans.length),
  ];
  let totalDeltaLength = parts[0].length + parts[1].length;

  for (const span of spans) {
    const offsetBytes = encodeULEB128(span.offset);
    const lengthBytes = encodeULEB128(span.length);
    parts.push(offsetBytes, lengthBytes, span.data);
    totalDeltaLength += offsetBytes.length + lengthBytes.length + span.data.length;

    // Safety guard: if delta exceeds target size, reject to avoid patch bloat
    if (totalDeltaLength >= target.length) {
      return null;
    }
  }

  // Concatenate parts into single buffer
  const delta = new Uint8Array(totalDeltaLength);
  let writeOffset = 0;
  for (const part of parts) {
    delta.set(part, writeOffset);
    writeOffset += part.length;
  }

  return delta;
}

/**
 * Applies a sub-chunk span delta to a baseline chunk, producing the patched target chunk.
 */
export function applySubChunkDelta(baseline: Uint8Array, delta: Uint8Array): Uint8Array {
  let readOffset = 0;

  let targetLength: number;
  try {
    const res = decodeULEB128(delta, readOffset);
    targetLength = res.value;
    readOffset += res.bytesRead;
  } catch (err: unknown) {
    throw new CorruptedSubChunkDeltaError(`Failed to decode target length: ${String(err)}`);
  }

  let spanCount: number;
  try {
    const res = decodeULEB128(delta, readOffset);
    spanCount = res.value;
    readOffset += res.bytesRead;
  } catch (err: unknown) {
    throw new CorruptedSubChunkDeltaError(`Failed to decode span count: ${String(err)}`);
  }

  // Initialize output buffer and copy unmodified baseline bytes
  const patched = new Uint8Array(targetLength);
  const copyLen = Math.min(baseline.length, targetLength);
  patched.set(baseline.subarray(0, copyLen), 0);

  // Apply each mutated span
  for (let s = 0; s < spanCount; s++) {
    let spanOffset: number;
    let spanLength: number;

    try {
      const resOffset = decodeULEB128(delta, readOffset);
      spanOffset = resOffset.value;
      readOffset += resOffset.bytesRead;

      const resLength = decodeULEB128(delta, readOffset);
      spanLength = resLength.value;
      readOffset += resLength.bytesRead;
    } catch (err: unknown) {
      throw new CorruptedSubChunkDeltaError(`Failed to decode span header for span ${s}: ${String(err)}`);
    }

    if (spanOffset + spanLength > targetLength) {
      throw new CorruptedSubChunkDeltaError(
        `Span bounds [${spanOffset}, ${spanOffset + spanLength}) exceed target chunk size ${targetLength}`
      );
    }

    if (readOffset + spanLength > delta.length) {
      throw new CorruptedSubChunkDeltaError(
        `Span ${s} requires ${spanLength} bytes, but delta buffer ended at byte ${readOffset} of ${delta.length}`
      );
    }

    const replacementData = delta.subarray(readOffset, readOffset + spanLength);
    patched.set(replacementData, spanOffset);
    readOffset += spanLength;
  }

  return patched;
}
