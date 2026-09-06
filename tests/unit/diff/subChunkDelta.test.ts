import { describe, it, expect } from "vitest";
import {
  computeSubChunkDelta,
  applySubChunkDelta,
} from "../../../src/diff/subChunkDelta.js";
import { CorruptedSubChunkDeltaError } from "../../../src/diff/errors.js";

describe("Sub-Chunk Secondary Span Delta", () => {
  it("should compress a localized 12-byte mutation in an 8 KB chunk down to < 50 bytes (Experiment 6)", () => {
    const size = 8192;
    const baseline = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      baseline[i] = (i * 17) & 0xFF;
    }

    const target = new Uint8Array(baseline);
    // Mutate 12 bytes at offset 1500
    for (let i = 1500; i < 1512; i++) {
      target[i] = 0xEE;
    }

    const delta = computeSubChunkDelta(baseline, target);
    expect(delta).not.toBeNull();
    // Delta size should be tiny (< 50 bytes)
    expect(delta!.length).toBeLessThan(50);

    // Reconstruct and verify exact equality
    const patched = applySubChunkDelta(baseline, delta!);
    expect(patched).toEqual(target);
  });

  it("should compress multiple dispersed spans and round-trip successfully", () => {
    const size = 4096;
    const baseline = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      baseline[i] = (i * 31) & 0xFF;
    }

    const target = new Uint8Array(baseline);
    // Mutate span 1
    target[100] = 0xAA;
    target[101] = 0xBB;
    // Mutate span 2
    target[500] = 0xCC;
    target[501] = 0xDD;
    // Mutate span 3
    target[2000] = 0xEE;

    const delta = computeSubChunkDelta(baseline, target);
    expect(delta).not.toBeNull();

    const patched = applySubChunkDelta(baseline, delta!);
    expect(patched).toEqual(target);
  });

  it("should return null for chunks with similarity below 80%", () => {
    const size = 1000;
    const baseline = new Uint8Array(size).fill(0x11);
    const target = new Uint8Array(size).fill(0x22); // 0% similarity

    const delta = computeSubChunkDelta(baseline, target);
    expect(delta).toBeNull();
  });

  it("should return null for empty inputs", () => {
    expect(computeSubChunkDelta(new Uint8Array(0), new Uint8Array(10))).toBeNull();
    expect(computeSubChunkDelta(new Uint8Array(10), new Uint8Array(0))).toBeNull();
  });

  it("should handle target chunk longer than baseline chunk", () => {
    const baseline = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const target = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // Append 2 bytes (> 80% similarity)

    const delta = computeSubChunkDelta(baseline, target);
    expect(delta).not.toBeNull();

    const patched = applySubChunkDelta(baseline, delta!);
    expect(patched).toEqual(target);
  });

  it("should throw CorruptedSubChunkDeltaError on out-of-bounds span offsets", () => {
    const baseline = new Uint8Array(100);
    // Construct corrupted delta claiming a span at offset 500 when targetLength is 100
    // [targetLength: 100] [spanCount: 1] [spanOffset: 500] [spanLength: 10]
    const corruptedDelta = new Uint8Array([
      100, // targetLength = 100
      1,   // spanCount = 1
      0xF4, 0x03, // spanOffset = 500 (uLEB128: 500 = 0x01F4)
      10,  // spanLength = 10
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);

    expect(() => applySubChunkDelta(baseline, corruptedDelta)).toThrow(CorruptedSubChunkDeltaError);
  });

  it("should throw CorruptedSubChunkDeltaError on truncated delta buffer", () => {
    const baseline = new Uint8Array(100);
    // Delta claims 10 bytes of replacement data but only provides 2
    const truncatedDelta = new Uint8Array([
      100, // targetLength = 100
      1,   // spanCount = 1
      10,  // spanOffset = 10
      10,  // spanLength = 10
      1, 2, // only 2 bytes provided!
    ]);

    expect(() => applySubChunkDelta(baseline, truncatedDelta)).toThrow(CorruptedSubChunkDeltaError);
  });
});
