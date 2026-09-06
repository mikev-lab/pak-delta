import { describe, it, expect } from "vitest";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { buildSyntheticArchive } from "../../fixtures/syntheticArchive.js";
import { reconstituteArchive } from "../../../src/repack/assembler.js";
import {
  BaselineSha256MismatchError,
  ChunkHashMismatchError,
  TargetSha256MismatchError,
  CorruptedOpcodePayloadError,
  Crc32MismatchError,
} from "../../../src/repack/errors.js";
import type { DeltaRecipeManifest } from "../../../src/types.js";
import { computeChunkHashSync } from "../../../src/chunker/fingerprint.js";

describe("Client Assembler Error & Chaos Resilience", () => {
  it("throws BaselineSha256MismatchError if baseline archive does not match manifest", async () => {
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "a.bin", data: new Uint8Array([1, 2, 3]) }],
    });
    const reader = new MemoryBinaryReader(baseline.bytes);

    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: "0000000000000000000000000000000000000000000000000000000000000000",
      targetArchiveSha256: "1111111111111111111111111111111111111111111111111111111111111111",
      targetTotalUncompressedBytes: 3,
      entries: [],
      rawPayloadSize: 0,
      rawPayloadPool: new Uint8Array(0),
    };

    await expect(() => reconstituteArchive(reader, manifest)).rejects.toThrow(BaselineSha256MismatchError);
  });

  it("throws ChunkHashMismatchError if a chunk payload fails SHA-256 verification", async () => {
    const rawData = new Uint8Array([1, 2, 3, 4, 5]);
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "data.bin", data: rawData, compressed: false }],
    });
    const reader = new MemoryBinaryReader(baseline.bytes);
    const baselineSha256 = computeChunkHashSync(baseline.bytes);

    const corruptChunkHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: baselineSha256,
      targetArchiveSha256: "placeholder",
      targetTotalUncompressedBytes: 5,
      entries: [
        {
          filename: "data.bin",
          compressionMethod: 0,
          repackMode: "standard",
          uncompressedSize: 5,
          compressedSize: 5,
          crc32: 0,
          opcodes: [
            {
              type: "INSERT",
              payloadOffset: 0,
              length: 5,
              chunkHash: corruptChunkHash, // Mismatched chunk hash
            },
          ],
        },
      ],
      rawPayloadSize: 5,
      rawPayloadPool: rawData,
    };

    await expect(() => reconstituteArchive(reader, manifest)).rejects.toThrow(ChunkHashMismatchError);
  });

  it("throws CorruptedOpcodePayloadError if opcode payload offset exceeds payload pool bounds", async () => {
    const rawData = new Uint8Array([1, 2, 3]);
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "data.bin", data: rawData, compressed: false }],
    });
    const reader = new MemoryBinaryReader(baseline.bytes);
    const baselineSha256 = computeChunkHashSync(baseline.bytes);

    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: baselineSha256,
      targetArchiveSha256: "placeholder",
      targetTotalUncompressedBytes: 3,
      entries: [
        {
          filename: "data.bin",
          compressionMethod: 0,
          repackMode: "standard",
          uncompressedSize: 3,
          compressedSize: 3,
          crc32: 0,
          opcodes: [
            {
              type: "INSERT",
              payloadOffset: 100, // Out of bounds!
              length: 3,
              chunkHash: "abc",
            },
          ],
        },
      ],
      rawPayloadSize: 0,
      rawPayloadPool: new Uint8Array(0),
    };

    await expect(() => reconstituteArchive(reader, manifest)).rejects.toThrow(CorruptedOpcodePayloadError);
  });

  it("throws Crc32MismatchError if reassembled uncompressed data fails CRC check", async () => {
    const rawData = new Uint8Array([10, 20, 30, 40]);
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "file.bin", data: rawData, compressed: false }],
    });
    const reader = new MemoryBinaryReader(baseline.bytes);
    const baselineSha256 = computeChunkHashSync(baseline.bytes);
    const chunkHash = computeChunkHashSync(rawData);

    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: baselineSha256,
      targetArchiveSha256: "placeholder",
      targetTotalUncompressedBytes: 4,
      entries: [
        {
          filename: "file.bin",
          compressionMethod: 0,
          repackMode: "standard",
          uncompressedSize: 4,
          compressedSize: 4,
          crc32: 0xDEADBEEF, // Incorrect expected CRC32
          opcodes: [
            {
              type: "INSERT",
              payloadOffset: 0,
              length: 4,
              chunkHash,
            },
          ],
        },
      ],
      rawPayloadSize: 4,
      rawPayloadPool: rawData,
    };

    await expect(() => reconstituteArchive(reader, manifest)).rejects.toThrow(Crc32MismatchError);
  });

  it("throws TargetSha256MismatchError if final archive does not match expected target hash", async () => {
    const rawData = new Uint8Array([65, 66, 67, 68]);
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "file.bin", data: rawData, compressed: false }],
    });
    const reader = new MemoryBinaryReader(baseline.bytes);
    const baselineSha256 = computeChunkHashSync(baseline.bytes);
    const chunkHash = computeChunkHashSync(rawData);

    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: baselineSha256,
      targetArchiveSha256: "0000000000000000000000000000000000000000000000000000000000000000", // Wrong target SHA-256
      targetTotalUncompressedBytes: 4,
      entries: [
        {
          filename: "file.bin",
          compressionMethod: 0,
          repackMode: "standard",
          uncompressedSize: 4,
          compressedSize: 4,
          crc32: baseline.records[0].crc32,
          opcodes: [
            {
              type: "INSERT",
              payloadOffset: 0,
              length: 4,
              chunkHash,
            },
          ],
        },
      ],
      rawPayloadSize: 4,
      rawPayloadPool: rawData,
    };

    await expect(() => reconstituteArchive(reader, manifest)).rejects.toThrow(TargetSha256MismatchError);
  });
});
