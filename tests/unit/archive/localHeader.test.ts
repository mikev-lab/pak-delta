import { describe, it, expect } from "vitest";
import { readLocalFileHeader } from "../../../src/archive/localHeader.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { InvalidArchiveHeaderError, TruncatedArchiveError } from "../../../src/archive/errors.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("Local File Header Parser", () => {
  it("should accurately parse Local File Header and compute exact payload dataOffset", async () => {
    const p = generateSyntheticPayload(300, 70);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "nested/path/to/asset.raw", data: p, compressed: false }],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const lfh = await readLocalFileHeader(reader, 0);

    expect(lfh.filename).toBe("nested/path/to/asset.raw");
    expect(lfh.localHeaderOffset).toBe(0);
    expect(lfh.dataOffset).toBe(30 + new TextEncoder().encode("nested/path/to/asset.raw").length);
    expect(lfh.compressionMethod).toBe(0);
    expect(lfh.uncompressedSize).toBe(300);
  });

  it("should throw TruncatedArchiveError if localHeaderOffset exceeds archive boundary", async () => {
    const dummyReader = new MemoryBinaryReader(new Uint8Array(50));
    await expect(readLocalFileHeader(dummyReader, 100)).rejects.toThrow(TruncatedArchiveError);
  });

  it("should throw InvalidArchiveHeaderError if LFH signature is corrupt", async () => {
    const corruptedBuffer = new Uint8Array(50);
    corruptedBuffer.fill(0xFF);
    const reader = new MemoryBinaryReader(corruptedBuffer);

    await expect(readLocalFileHeader(reader, 0)).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("should throw TruncatedArchiveError if variable length fields exceed archive size", async () => {
    const p = generateSyntheticPayload(100, 80);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "test.dat", data: p }],
    });

    const corruptedBytes = new Uint8Array(archive.bytes);
    const view = new DataView(corruptedBytes.buffer);
    // Overwrite filename length in LFH to an impossible size exceeding archive
    view.setUint16(26, 60000, true);

    const reader = new MemoryBinaryReader(corruptedBytes);
    await expect(readLocalFileHeader(reader, 0)).rejects.toThrow(TruncatedArchiveError);
  });

  it("should throw TruncatedArchiveError if localHeaderOffset is negative", async () => {
    const dummyReader = new MemoryBinaryReader(new Uint8Array(50));
    await expect(readLocalFileHeader(dummyReader, -5)).rejects.toThrow(TruncatedArchiveError);
  });

  it("should parse Local File Header with zero variable length fields", async () => {
    // Construct 30-byte LFH with 0 filename length and 0 extra field length
    const lfh = new Uint8Array(30);
    const view = new DataView(lfh.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(26, 0, true); // filename length = 0
    view.setUint16(28, 0, true); // extra field length = 0

    const reader = new MemoryBinaryReader(lfh);
    const result = await readLocalFileHeader(reader, 0);

    expect(result.filename).toBe("");
    expect(result.extraField.length).toBe(0);
    expect(result.dataOffset).toBe(30);
  });
});
