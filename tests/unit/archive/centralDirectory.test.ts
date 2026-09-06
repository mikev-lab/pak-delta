import { describe, it, expect } from "vitest";
import { parseCentralDirectory } from "../../../src/archive/centralDirectory.js";
import { findAndParseEOCD } from "../../../src/archive/eocd.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { InvalidArchiveHeaderError, TruncatedArchiveError } from "../../../src/archive/errors.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("Central Directory Parser", () => {
  it("should return empty array for 0 entries", async () => {
    const dummyReader = new MemoryBinaryReader(new Uint8Array(100));
    const entries = await parseCentralDirectory(dummyReader, 0, 0, 0);
    expect(entries).toEqual([]);
  });

  it("should accurately parse multiple Central Directory records", async () => {
    const p1 = generateSyntheticPayload(256, 10);
    const p2 = generateSyntheticPayload(512, 20);

    const archive = await buildSyntheticArchive({
      entries: [
        { name: "config/settings.json", data: p1, compressed: false },
        { name: "textures/grass.bin", data: p2, compressed: true },
      ],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);
    const entries = await parseCentralDirectory(
      reader,
      eocd.centralDirectoryOffset,
      eocd.centralDirectorySize,
      eocd.totalEntries
    );

    expect(entries.length).toBe(2);

    expect(entries[0].index).toBe(0);
    expect(entries[0].filename).toBe("config/settings.json");
    expect(entries[0].compressionMethod).toBe(0);
    expect(entries[0].uncompressedSize).toBe(256);
    expect(entries[0].hasDataDescriptor).toBe(false);

    expect(entries[1].index).toBe(1);
    expect(entries[1].filename).toBe("textures/grass.bin");
    expect(entries[1].compressionMethod).toBe(8);
    expect(entries[1].uncompressedSize).toBe(512);
    expect(entries[1].hasDataDescriptor).toBe(false);
  });

  it("should detect hasDataDescriptor flag on streaming entries", async () => {
    const p = generateSyntheticPayload(128, 30);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "stream/data.pak", data: p, useDataDescriptor: true }],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);
    const entries = await parseCentralDirectory(
      reader,
      eocd.centralDirectoryOffset,
      eocd.centralDirectorySize,
      eocd.totalEntries
    );

    expect(entries.length).toBe(1);
    expect(entries[0].hasDataDescriptor).toBe(true);
    expect((entries[0].bitFlag & 0x0008)).toBe(0x0008);
  });

  it("should throw TruncatedArchiveError if Central Directory buffer ends prematurely", async () => {
    const p = generateSyntheticPayload(128, 40);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "file.txt", data: p }],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);

    // Provide truncated size to parseCentralDirectory
    await expect(
      parseCentralDirectory(reader, eocd.centralDirectoryOffset, 20, eocd.totalEntries)
    ).rejects.toThrow(TruncatedArchiveError);
  });

  it("should throw InvalidArchiveHeaderError if CDFH signature is corrupt", async () => {
    const p = generateSyntheticPayload(128, 50);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "file.txt", data: p }],
    });

    const corruptedBytes = new Uint8Array(archive.bytes);
    const view = new DataView(corruptedBytes.buffer);
    // Overwrite CDFH signature at centralDirectoryOffset
    view.setUint32(archive.centralDirectoryOffset, 0xDEADBEEF, true);

    const reader = new MemoryBinaryReader(corruptedBytes);
    const eocd = await findAndParseEOCD(reader);

    await expect(
      parseCentralDirectory(reader, eocd.centralDirectoryOffset, eocd.centralDirectorySize, eocd.totalEntries)
    ).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("should throw TruncatedArchiveError if variable length fields exceed directory buffer", async () => {
    const p = generateSyntheticPayload(128, 60);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "file.txt", data: p }],
    });

    const corruptedBytes = new Uint8Array(archive.bytes);
    const view = new DataView(corruptedBytes.buffer);
    // Overwrite filename length in CDFH to 10,000 bytes
    view.setUint16(archive.centralDirectoryOffset + 28, 10000, true);

    const reader = new MemoryBinaryReader(corruptedBytes);
    const eocd = await findAndParseEOCD(reader);

    await expect(
      parseCentralDirectory(reader, eocd.centralDirectoryOffset, eocd.centralDirectorySize, eocd.totalEntries)
    ).rejects.toThrow(TruncatedArchiveError);
  });
});
