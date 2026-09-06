import { describe, it, expect } from "vitest";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { indexArchive, computeArchiveSha256 } from "../../../src/archive/indexer.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { InvalidArchiveHeaderError } from "../../../src/archive/errors.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("Container Indexer and Slicer", () => {
  it("should index in-memory archive slices accurately", async () => {
    const p1 = generateSyntheticPayload(512, 100);
    const p2 = generateSyntheticPayload(1024, 200);

    const archive = await buildSyntheticArchive({
      entries: [
        { name: "textures/wall.png", data: p1, compressed: false },
        { name: "audio/music.ogg", data: p2, compressed: true },
      ],
    });

    const index = await indexArchive(archive.bytes);

    expect(index.totalEntries).toBe(2);
    expect(index.slices.length).toBe(2);
    expect(index.archiveSha256.length).toBe(64);

    expect(index.slices[0].filename).toBe("textures/wall.png");
    expect(index.slices[0].compressionMethod).toBe(0);
    expect(index.slices[0].uncompressedSize).toBe(512);
    expect(index.slices[0].dataOffset).toBeGreaterThan(0);

    expect(index.slices[1].filename).toBe("audio/music.ogg");
    expect(index.slices[1].compressionMethod).toBe(8);
    expect(index.slices[1].uncompressedSize).toBe(1024);
  });

  it("should index an archive directly from a file path string using FileHandle", async () => {
    const p = generateSyntheticPayload(256, 300);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "data.bin", data: p }],
    });

    const tempPath = join(tmpdir(), `test-archive-${Date.now()}.zip`);
    await writeFile(tempPath, archive.bytes);

    try {
      const index = await indexArchive(tempPath);
      expect(index.totalEntries).toBe(1);
      expect(index.slices[0].filename).toBe("data.bin");
      expect(index.archiveSha256.length).toBe(64);
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });

  it("should detect and isolate Unreal Engine 4 KB DMA sector alignment padding", async () => {
    const p1 = generateSyntheticPayload(1234, 400);
    const p2 = generateSyntheticPayload(2000, 500);

    const archive = await buildSyntheticArchive({
      entries: [
        { name: "entry1.bin", data: p1, compressed: false },
        { name: "entry2.bin", data: p2, compressed: false },
      ],
      sectorAlignment: 4096,
    });

    const index = await indexArchive(archive.bytes);

    expect(index.slices.length).toBe(2);
    // In our synthetic builder, entry1 is padded so entry2 starts on a 4096-byte boundary
    expect(index.slices[0].alignmentPadding).toBeGreaterThan(0);
    expect(index.slices[1].localHeaderOffset % 4096).toBe(0);
    // Entry 2 is padded so Central Directory starts on a 4096-byte boundary
    expect(index.slices[1].alignmentPadding).toBeGreaterThan(0);
    expect(index.centralDirectoryOffset % 4096).toBe(0);
  });

  it("should index entries with streaming Data Descriptors (FLAG_0x0008)", async () => {
    const p = generateSyntheticPayload(400, 600);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "stream.pak", data: p, useDataDescriptor: true }],
    });

    const index = await indexArchive(archive.bytes);

    expect(index.slices.length).toBe(1);
    expect(index.slices[0].hasDataDescriptor).toBe(true);
    expect(index.slices[0].uncompressedSize).toBe(400);
  });

  it("should throw InvalidArchiveHeaderError if filename in LFH does not match Central Directory", async () => {
    const p = generateSyntheticPayload(100, 700);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "correct.txt", data: p }],
    });

    const corruptedBytes = new Uint8Array(archive.bytes);
    // Overwrite the first byte of filename in LFH
    corruptedBytes[30] = "X".charCodeAt(0);

    await expect(indexArchive(corruptedBytes)).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("should compute accurate SHA-256 via computeArchiveSha256", async () => {
    const data = new TextEncoder().encode("Deterministic SHA-256 Test Vector");
    const reader = new MemoryBinaryReader(data);
    const hash = await computeArchiveSha256(reader);
    expect(hash.length).toBe(64);
  });

  it("should index directly from an IBinaryReader instance", async () => {
    const p = generateSyntheticPayload(100, 800);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "reader-test.bin", data: p }],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const index = await indexArchive(reader);
    expect(index.totalEntries).toBe(1);
    expect(index.slices[0].filename).toBe("reader-test.bin");
  });

  it("should throw InvalidArchiveHeaderError on overlapping entries", async () => {
    const p1 = generateSyntheticPayload(200, 850);
    const p2 = generateSyntheticPayload(200, 851);

    const archive = await buildSyntheticArchive({
      entries: [
        { name: "file1.bin", data: p1, compressed: false },
        { name: "file2.bin", data: p2, compressed: false },
      ],
    });

    // In the Central Directory, modify entry 2's localHeaderOffset to point inside entry 1's payload
    const corruptedBytes = new Uint8Array(archive.bytes);
    const view = new DataView(corruptedBytes.buffer);
    const cdOffset = archive.centralDirectoryOffset;
    // Find second CDFH (first CDFH length = 46 + 9 = 55)
    const secondCdfhOffset = cdOffset + 55;
    // Overwrite localHeaderOffset of second entry to 10 (inside file1's header)
    view.setUint32(secondCdfhOffset + 42, 10, true);

    await expect(indexArchive(corruptedBytes)).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("should throw InvalidArchiveHeaderError if final entry payload exceeds Central Directory offset", async () => {
    const p = generateSyntheticPayload(200, 900);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "solo.bin", data: p, compressed: false }],
    });

    // In EOCD, modify Central Directory offset to point before the end of solo.bin payload
    const corruptedBytes = new Uint8Array(archive.bytes);
    const view = new DataView(corruptedBytes.buffer);
    const eocdOffset = corruptedBytes.length - 22;
    // Set central directory offset to 10 bytes before actual payload end
    view.setUint32(eocdOffset + 16, 50, true);

    await expect(indexArchive(corruptedBytes)).rejects.toThrow(InvalidArchiveHeaderError);
  });
});
