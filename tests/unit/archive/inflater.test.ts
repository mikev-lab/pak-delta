import { describe, it, expect } from "vitest";
import {
  inflateEntrySlice,
  inflateEntrySliceToBuffer,
  createEntryInflaterStream,
  updateCrc32,
} from "../../../src/archive/inflater.js";
import {
  createSliceReadableStream,
  readableStreamToAsyncIterable,
  collectChunks,
} from "../../../src/archive/streamUtils.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { indexArchive } from "../../../src/archive/indexer.js";
import {
  DeflateCorruptionError,
  Crc32MismatchError,
  TruncatedArchiveError,
  UnsupportedCompressionMethodError,
} from "../../../src/archive/errors.js";
import {
  buildSyntheticArchive,
  generateSyntheticPayload,
  computeCrc32,
} from "../../fixtures/syntheticArchive.js";

describe("Streaming Inflater and Normalization Engine", () => {
  describe("updateCrc32 and Stream Utilities", () => {
    it("should compute running CRC32 identically to monolithic CRC32 across multiple chunks", () => {
      const p1 = new TextEncoder().encode("Chunk 1: Hello ");
      const p2 = new TextEncoder().encode("Chunk 2: World ");
      const p3 = new TextEncoder().encode("Chunk 3: pak-delta!");

      let running = 0xFFFFFFFF;
      running = updateCrc32(running, p1);
      running = updateCrc32(running, p2);
      running = updateCrc32(running, p3);
      const finalCrc = (running ^ 0xFFFFFFFF) >>> 0;

      const combined = new TextEncoder().encode("Chunk 1: Hello Chunk 2: World Chunk 3: pak-delta!");
      const expectedCrc = computeCrc32(combined);
      expect(finalCrc).toBe(expectedCrc);
    });

    it("should read slice stream in custom bounded chunk windows", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const reader = new MemoryBinaryReader(data);
      const stream = createSliceReadableStream(reader, 2, 6, 2); // 6 bytes starting at offset 2, chunked in 2s

      const chunks: Uint8Array[] = [];
      for await (const chunk of readableStreamToAsyncIterable(stream)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(3);
      expect(Array.from(chunks[0])).toEqual([3, 4]);
      expect(Array.from(chunks[1])).toEqual([5, 6]);
      expect(Array.from(chunks[2])).toEqual([7, 8]);
    });

    it("should propagate reader errors through createSliceReadableStream", async () => {
      const mockReader = {
        size: 100,
        readAt: async () => {
          throw new Error("Disk I/O error");
        },
      };

      const stream = createSliceReadableStream(mockReader, 0, 50);
      await expect(collectChunks(readableStreamToAsyncIterable(stream))).rejects.toThrow("Disk I/O error");
    });

    it("should enforce size limit guard in collectChunks", async () => {
      async function* generateChunks() {
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array([4, 5, 6]);
      }

      await expect(collectChunks(generateChunks(), 4)).rejects.toThrow(RangeError);
    });
  });

  describe("Entry Slicing and Inflation", () => {
    it("should inflate Stored entry slice (method 0) directly", async () => {
      const payload = generateSyntheticPayload(1024, 1000);
      const archive = await buildSyntheticArchive({
        entries: [{ name: "uncompressed.bin", data: payload, compressed: false }],
      });

      const index = await indexArchive(archive.bytes);
      expect(index.slices.length).toBe(1);
      const slice = index.slices[0];
      expect(slice.compressionMethod).toBe(0);

      const reader = new MemoryBinaryReader(archive.bytes);
      const decompressed = await inflateEntrySliceToBuffer(reader, slice);

      expect(decompressed.length).toBe(1024);
      expect(decompressed).toEqual(payload);
    });

    it("should inflate Deflated entry slice (method 8) with bit-for-bit parity", async () => {
      const payload = generateSyntheticPayload(4096, 2000);
      const archive = await buildSyntheticArchive({
        entries: [{ name: "deflated.dat", data: payload, compressed: true }],
      });

      const index = await indexArchive(archive.bytes);
      const slice = index.slices[0];
      expect(slice.compressionMethod).toBe(8);

      const reader = new MemoryBinaryReader(archive.bytes);
      const decompressed = await inflateEntrySliceToBuffer(reader, slice);

      expect(decompressed.length).toBe(4096);
      expect(decompressed).toEqual(payload);
    });

    it("should stream large uncompressed entries in bounded windows <= 64 KB", async () => {
      const largePayload = generateSyntheticPayload(300 * 1024, 3000); // 300 KB payload
      const archive = await buildSyntheticArchive({
        entries: [{ name: "large.bin", data: largePayload, compressed: true }],
      });

      const index = await indexArchive(archive.bytes);
      const slice = index.slices[0];

      const reader = new MemoryBinaryReader(archive.bytes);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      for await (const chunk of inflateEntrySlice(reader, slice)) {
        // Invariant: every yielded chunk must not exceed 64 KB (65536 bytes)
        expect(chunk.length).toBeLessThanOrEqual(65536);
        chunks.push(chunk);
        totalBytes += chunk.length;
      }

      expect(totalBytes).toBe(300 * 1024);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should throw UnsupportedCompressionMethodError for unknown compression methods", async () => {
      const fakeSlice = {
        index: 0,
        filename: "unsupported.bin",
        compressionMethod: 14, // LZMA
        localHeaderOffset: 0,
        dataOffset: 30,
        compressedSize: 100,
        uncompressedSize: 200,
        crc32: 0x12345678,
        extraFieldLength: 0,
      };

      const dummyReader = new MemoryBinaryReader(new Uint8Array(200));

      expect(() => createEntryInflaterStream(dummyReader, fakeSlice)).toThrow(
        UnsupportedCompressionMethodError
      );

      await expect(async () => {
        for await (const _ of inflateEntrySlice(dummyReader, fakeSlice)) {
          // No-op
        }
      }).rejects.toThrow(UnsupportedCompressionMethodError);
    });

    it("should throw DeflateCorruptionError when DEFLATE bitstream is corrupted", async () => {
      const payload = generateSyntheticPayload(1024, 4000);
      const archive = await buildSyntheticArchive({
        entries: [{ name: "corrupt.bin", data: payload, compressed: true }],
      });

      const index = await indexArchive(archive.bytes);
      const slice = index.slices[0];

      // Corrupt the compressed payload bytes directly
      const corruptedBytes = new Uint8Array(archive.bytes);
      // Invert bytes inside the compressed slice payload
      for (let i = slice.dataOffset; i < slice.dataOffset + 10; i++) {
        corruptedBytes[i] ^= 0xFF;
      }

      const reader = new MemoryBinaryReader(corruptedBytes);
      await expect(inflateEntrySliceToBuffer(reader, slice)).rejects.toThrow(DeflateCorruptionError);
    });

    it("should throw Crc32MismatchError if computed CRC32 does not match slice.crc32", async () => {
      const payload = generateSyntheticPayload(512, 5000);
      const archive = await buildSyntheticArchive({
        entries: [{ name: "mismatched.bin", data: payload, compressed: false }],
      });

      const index = await indexArchive(archive.bytes);
      const tamperedSlice = {
        ...index.slices[0],
        crc32: 0xDEADBEEF, // Tamper expected CRC32
      };

      const reader = new MemoryBinaryReader(archive.bytes);
      await expect(inflateEntrySliceToBuffer(reader, tamperedSlice)).rejects.toThrow(Crc32MismatchError);
    });

    it("should throw TruncatedArchiveError if decoded uncompressed size does not match slice.uncompressedSize", async () => {
      const payload = generateSyntheticPayload(512, 6000);
      const archive = await buildSyntheticArchive({
        entries: [{ name: "truncated.bin", data: payload, compressed: false }],
      });

      const index = await indexArchive(archive.bytes);
      const tamperedSlice = {
        ...index.slices[0],
        uncompressedSize: 1024, // Expect 1024 bytes, but only 512 exist
      };

      const reader = new MemoryBinaryReader(archive.bytes);
      await expect(inflateEntrySliceToBuffer(reader, tamperedSlice)).rejects.toThrow(TruncatedArchiveError);
    });

    it("should throw RangeError in inflateEntrySliceToBuffer if uncompressed size exceeds maxBytes limit", async () => {
      const payload = generateSyntheticPayload(1000, 7000);
      const archive = await buildSyntheticArchive({
        entries: [{ name: "oversized.bin", data: payload, compressed: false }],
      });

      const index = await indexArchive(archive.bytes);
      const slice = index.slices[0];

      const reader = new MemoryBinaryReader(archive.bytes);
      await expect(inflateEntrySliceToBuffer(reader, slice, 500)).rejects.toThrow(RangeError);
    });
  });
});
