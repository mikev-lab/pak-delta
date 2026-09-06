import { describe, it, expect } from "vitest";
import { chunkBuffer, chunkStream } from "../../../src/chunker/fastcdc.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { indexArchive } from "../../../src/archive/indexer.js";
import { inflateEntrySlice } from "../../../src/archive/inflater.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("FastCDC Content-Defined Chunking Engine", () => {
  it("should return empty array for empty buffer", async () => {
    const emptyBuf = new Uint8Array(0);
    const chunks = await chunkBuffer(emptyBuf);
    expect(chunks).toEqual([]);
  });

  it("should preserve boundary invariance under a 17-byte insertion (Experiment 2)", async () => {
    const size = 1024 * 1024; // 1 MB
    const original = generateSyntheticPayload(size, 42);

    // Insert 17 bytes at offset 10,000
    const mutated = new Uint8Array(size + 17);
    mutated.set(original.subarray(0, 10000), 0);
    mutated.set(new Uint8Array(17).fill(0x77), 10000);
    mutated.set(original.subarray(10000), 10017);

    const originalChunks = await chunkBuffer(original);
    const mutatedChunks = await chunkBuffer(mutated);

    expect(originalChunks.length).toBeGreaterThan(10);
    expect(mutatedChunks.length).toBeGreaterThan(10);

    const originalHashes = new Set(originalChunks.map((c) => c.hash));
    let matches = 0;
    for (const c of mutatedChunks) {
      if (originalHashes.has(c.hash)) {
        matches++;
      }
    }

    const matchRatio = matches / originalChunks.length;
    // FastCDC must retain > 98% matching chunks despite the 17-byte shift
    expect(matchRatio).toBeGreaterThan(0.98);
  });

  it("should cluster chunk sizes around target avgSize (Pareto profile)", async () => {
    const size = 512 * 1024; // 512 KB
    const data = generateSyntheticPayload(size, 88);

    const chunks = await chunkBuffer(data, {
      minSize: 2048,
      avgSize: 8192,
      maxSize: 32768,
    });

    expect(chunks.length).toBeGreaterThan(0);
    let totalLength = 0;
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThanOrEqual(2048);
      expect(chunk.length).toBeLessThanOrEqual(32768);
      totalLength += chunk.length;
    }
    expect(totalLength).toBe(size);

    const calculatedAvg = size / chunks.length;
    // Expected average around 8192 (+/- 40%)
    expect(calculatedAvg).toBeGreaterThan(4000);
    expect(calculatedAvg).toBeLessThan(14000);
  });

  it("should clamp degenerate low-entropy inputs safely at maxSize (Experiment 9)", async () => {
    const size = 512 * 1024; // 512 KB
    const maxSize = 32768; // 32 KB

    // 1. All Zeroes
    const zeroes = new Uint8Array(size).fill(0x00);
    const zeroChunks = await chunkBuffer(zeroes, { maxSize });
    expect(zeroChunks.length).toBe(16); // 512 KB / 32 KB = exactly 16 chunks
    for (const c of zeroChunks) {
      expect(c.length).toBe(maxSize);
    }

    // 2. All Ones
    const ones = new Uint8Array(size).fill(0xFF);
    const oneChunks = await chunkBuffer(ones, { maxSize });
    expect(oneChunks.length).toBe(16);
    for (const c of oneChunks) {
      expect(c.length).toBe(maxSize);
    }

    // 3. Alternating Pattern (0xAA55)
    const alternating = new Uint8Array(size);
    for (let i = 0; i < size; i += 2) {
      alternating[i] = 0xAA;
      alternating[i + 1] = 0x55;
    }
    const altChunks = await chunkBuffer(alternating, { maxSize });
    expect(altChunks.length).toBe(16);
    for (const c of altChunks) {
      expect(c.length).toBe(maxSize);
    }
  });

  it("should emit 100% identical chunk boundaries regardless of stream chunk fragmentation", async () => {
    const size = 128 * 1024; // 128 KB
    const data = generateSyntheticPayload(size, 77);

    // Baseline: chunk whole buffer at once
    const baselineChunks = await chunkBuffer(data);

    // Stream fragmented into 128-byte micro-windows
    async function* microFragments() {
      for (let i = 0; i < data.length; i += 128) {
        yield data.subarray(i, Math.min(i + 128, data.length));
      }
    }

    const streamedChunks: typeof baselineChunks = [];
    for await (const chunk of chunkStream(microFragments())) {
      streamedChunks.push(chunk);
    }

    expect(streamedChunks.length).toBe(baselineChunks.length);
    for (let i = 0; i < baselineChunks.length; i++) {
      expect(streamedChunks[i].offset).toBe(baselineChunks[i].offset);
      expect(streamedChunks[i].length).toBe(baselineChunks[i].length);
      expect(streamedChunks[i].hash).toBe(baselineChunks[i].hash);
    }
  });

  it("should emit chunk data payload only when emitPayload is true", async () => {
    const data = generateSyntheticPayload(16384, 99);

    // emitPayload: false
    const chunksWithoutPayload = await chunkBuffer(data, { emitPayload: false });
    expect(chunksWithoutPayload.length).toBeGreaterThan(0);
    for (const c of chunksWithoutPayload) {
      expect(c.data).toBeUndefined();
    }

    // emitPayload: true
    const chunksWithPayload = await chunkBuffer(data, { emitPayload: true });
    expect(chunksWithPayload.length).toBe(chunksWithoutPayload.length);
    for (let i = 0; i < chunksWithPayload.length; i++) {
      const c = chunksWithPayload[i];
      expect(c.data).toBeDefined();
      expect(c.data!.length).toBe(c.length);
      expect(c.data).toEqual(data.subarray(c.offset, c.offset + c.length));
    }
  });

  it("should integrate end-to-end with Phase 3 streaming inflater", async () => {
    const payload = generateSyntheticPayload(64 * 1024, 1234);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "game/level.pak", data: payload, compressed: true }],
    });

    const index = await indexArchive(archive.bytes);
    const slice = index.slices[0];
    const reader = new MemoryBinaryReader(archive.bytes);

    // Feed inflateEntrySlice directly into chunkStream
    const uncompressedStream = inflateEntrySlice(reader, slice);
    const chunks: Array<{ offset: number; length: number; hash: string }> = [];

    for await (const chunk of chunkStream(uncompressedStream)) {
      chunks.push({
        offset: chunk.offset,
        length: chunk.length,
        hash: chunk.hash,
      });
    }

    expect(chunks.length).toBeGreaterThan(0);
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    expect(totalLength).toBe(64 * 1024);
  });
});
