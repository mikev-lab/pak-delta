import { describe, it, expect } from "vitest";
import { serializeArchive, type ContainerEntryToWrite } from "../../../src/repack/writer.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { indexArchive } from "../../../src/archive/indexer.js";

describe("Deterministic Container Serializer (Writer)", () => {
  it("serializes entries with correct LFH, CDFH, and EOCD structures", async () => {
    const payload1 = new TextEncoder().encode("Hello World File 1");
    const payload2 = new TextEncoder().encode("Second file content in container");

    const entries: ContainerEntryToWrite[] = [
      {
        name: "file1.txt",
        compressionMethod: 0,
        crc32: 0x12345678,
        uncompressedSize: payload1.length,
        compressedSize: payload1.length,
        data: payload1,
      },
      {
        name: "dir/file2.txt",
        compressionMethod: 0,
        crc32: 0x87654321,
        uncompressedSize: payload2.length,
        compressedSize: payload2.length,
        data: payload2,
      },
    ];

    const result = serializeArchive(entries);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.centralDirectoryOffset).toBeGreaterThan(0);
    expect(result.centralDirectorySize).toBeGreaterThan(0);

    // Verify signatures
    const view = new DataView(result.bytes.buffer);
    // Entry 1 LFH signature
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // CDFH signature at centralDirectoryOffset
    expect(view.getUint32(result.centralDirectoryOffset, true)).toBe(0x02014b50);
    // EOCD signature at end
    const eocdOffset = result.centralDirectoryOffset + result.centralDirectorySize;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);

    // Parse back using indexArchive
    const reader = new MemoryBinaryReader(result.bytes);
    const index = await indexArchive(reader);
    expect(index.slices.length).toBe(2);
    expect(index.slices[0].filename).toBe("file1.txt");
    expect(index.slices[1].filename).toBe("dir/file2.txt");
  });

  it("applies sector alignment padding correctly", async () => {
    const payload = new Uint8Array(100);
    const paddingBytes = 384; // Alignment padding to test

    const entries: ContainerEntryToWrite[] = [
      {
        name: "aligned_asset.bin",
        compressionMethod: 0,
        crc32: 0,
        uncompressedSize: 100,
        compressedSize: 100,
        data: payload,
        alignmentPadding: paddingBytes,
      },
      {
        name: "next_asset.bin",
        compressionMethod: 0,
        crc32: 0,
        uncompressedSize: 50,
        compressedSize: 50,
        data: new Uint8Array(50),
      },
    ];

    const result = serializeArchive(entries);
    const reader = new MemoryBinaryReader(result.bytes);
    const index = await indexArchive(reader);

    expect(index.slices[0].alignmentPadding).toBe(paddingBytes);
    expect(index.slices[1].localHeaderOffset).toBe(
      index.slices[0].dataOffset + 100 + paddingBytes
    );
  });

  it("includes custom archive comment in EOCD", async () => {
    const comment = new TextEncoder().encode("Custom Unreal Engine PAK Comment");
    const entries: ContainerEntryToWrite[] = [
      {
        name: "test.dat",
        compressionMethod: 0,
        crc32: 0,
        uncompressedSize: 10,
        compressedSize: 10,
        data: new Uint8Array(10),
      },
    ];

    const result = serializeArchive(entries, comment);
    const reader = new MemoryBinaryReader(result.bytes);
    const index = await indexArchive(reader);

    expect(index.commentLength).toBe(comment.length);
  });
});
