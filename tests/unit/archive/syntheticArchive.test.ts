import { describe, it, expect } from "vitest";
import {
  buildSyntheticArchive,
  generateSyntheticPayload,
  computeCrc32,
  mulberry32,
  deflateRaw,
} from "../../fixtures/syntheticArchive.js";

describe("SyntheticArchiveGenerator", () => {
  it("should generate deterministic random numbers using mulberry32", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    const seq1 = [rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2()];
    expect(seq1).toEqual(seq2);
  });

  it("should compute accurate IEEE 802.3 CRC32 checksums", () => {
    const testData = new TextEncoder().encode("123456789");
    const crc = computeCrc32(testData);
    // Standard test vector for '123456789' is 0xCBF43926
    expect(crc).toBe(0xCBF43926);
  });

  it("should compress data using deflateRaw and decompress via DecompressionStream", async () => {
    const original = new TextEncoder().encode("Hello pak-delta archive compression pipeline!");
    const compressed = await deflateRaw(original);
    expect(compressed.length).toBeGreaterThan(0);

    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const decompressed = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      decompressed.set(c, off);
      off += c.length;
    }
    expect(new TextDecoder().decode(decompressed)).toBe("Hello pak-delta archive compression pipeline!");
  });

  it("should generate synthetic archive with stored and deflated entries", async () => {
    const payload1 = generateSyntheticPayload(1024, 42);
    const payload2 = generateSyntheticPayload(2048, 99);

    const archive = await buildSyntheticArchive({
      entries: [
        { name: "assets/texture.raw", data: payload1, compressed: false },
        { name: "assets/audio.bin", data: payload2, compressed: true },
      ],
      comment: new TextEncoder().encode("Test archive comment"),
    });

    expect(archive.bytes.length).toBeGreaterThan(0);
    expect(archive.records.length).toBe(2);
    expect(archive.records[0].name).toBe("assets/texture.raw");
    expect(archive.records[0].compressionMethod).toBe(0);
    expect(archive.records[1].name).toBe("assets/audio.bin");
    expect(archive.records[1].compressionMethod).toBe(8);
    expect(archive.commentLength).toBe(20);
  });

  it("should generate synthetic archive with DMA sector alignment padding", async () => {
    const payload = generateSyntheticPayload(1234, 100);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "pak/mesh.bin", data: payload, compressed: false }],
      sectorAlignment: 4096,
    });

    expect(archive.records[0].alignmentPadding).toBeGreaterThan(0);
    // Verify that the Central Directory starts on a 4096-byte boundary
    expect(archive.centralDirectoryOffset % 4096).toBe(0);
  });

  it("should generate synthetic archive with streaming Data Descriptors", async () => {
    const payload = generateSyntheticPayload(512, 101);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "streaming/asset.dat", data: payload, useDataDescriptor: true }],
    });

    expect(archive.records[0].useDataDescriptor).toBe(true);
    // Inspect the generated LFH in archive bytes to verify CRC32 and sizes are 0
    const lfhOffset = archive.records[0].localHeaderOffset;
    const lfhView = new DataView(archive.bytes.buffer, archive.bytes.byteOffset + lfhOffset, 30);
    expect(lfhView.getUint16(6, true) & 0x0008).toBe(0x0008);
    expect(lfhView.getUint32(14, true)).toBe(0); // CRC32 = 0
    expect(lfhView.getUint32(18, true)).toBe(0); // Compressed size = 0
    expect(lfhView.getUint32(22, true)).toBe(0); // Uncompressed size = 0
  });
});
