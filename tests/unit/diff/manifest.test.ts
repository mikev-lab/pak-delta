import { describe, it, expect } from "vitest";
import {
  serializeManifest,
  deserializeManifest,
  PAKD_MAGIC,
  PAKD_VERSION,
} from "../../../src/diff/manifest.js";
import { InvalidManifestError } from "../../../src/diff/errors.js";
import type { DeltaRecipeManifest } from "../../../src/types.js";

describe("Binary PAKD Delta Recipe Manifest Serializer", () => {
  const dummySha256A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const dummySha256B = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  const dummyChunkHash1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const dummyChunkHash2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const dummyChunkHash3 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

  it("round-trips an empty manifest with no entries or payload", () => {
    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: dummySha256A,
      targetArchiveSha256: dummySha256B,
      targetTotalUncompressedBytes: 0,
      entries: [],
      rawPayloadSize: 0,
      rawPayloadPool: new Uint8Array(0),
    };

    const binary = serializeManifest(manifest);
    expect(binary.byteLength).toBeGreaterThanOrEqual(70);

    const deserialized = deserializeManifest(binary);
    expect(deserialized.magic).toBe("PAKD");
    expect(deserialized.version).toBe("1.0.0");
    expect(deserialized.sourceArchiveSha256).toBe(dummySha256A);
    expect(deserialized.targetArchiveSha256).toBe(dummySha256B);
    expect(deserialized.targetTotalUncompressedBytes).toBe(0);
    expect(deserialized.entries).toEqual([]);
    expect(deserialized.rawPayloadSize).toBe(0);
    expect(deserialized.rawPayloadPool).toBeDefined();
    expect(deserialized.rawPayloadPool!.length).toBe(0);
  });

  it("round-trips a rich manifest with COPY, PATCH, and INSERT opcodes and payload pool", () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);

    const manifest: DeltaRecipeManifest = {
      magic: "PAKD",
      version: "1.0.0",
      sourceArchiveSha256: dummySha256A,
      targetArchiveSha256: dummySha256B,
      targetTotalUncompressedBytes: 131072,
      entries: [
        {
          filename: "textures/hero.png",
          compressionMethod: 8,
          repackMode: "standard",
          uncompressedSize: 65536,
          compressedSize: 32768,
          crc32: 0x12345678,
          alignmentPadding: 4,
          opcodes: [
            {
              type: "COPY",
              sourceOffset: 0,
              length: 8192,
              chunkHash: dummyChunkHash1,
            },
            {
              type: "PATCH",
              sourceOffset: 8192,
              length: 8192,
              deltaOffset: 0,
              deltaLength: 4,
              chunkHash: dummyChunkHash2,
            },
          ],
        },
        {
          filename: "audio/theme.wav",
          compressionMethod: 0,
          repackMode: "bit_preserving",
          uncompressedSize: 65536,
          compressedSize: 65536,
          crc32: 0x87654321,
          alignmentPadding: 0,
          opcodes: [
            {
              type: "INSERT",
              payloadOffset: 4,
              length: 4,
              chunkHash: dummyChunkHash3,
            },
          ],
        },
      ],
      rawPayloadSize: payload.length,
      rawPayloadPool: payload,
    };

    const binary = serializeManifest(manifest);
    const deserialized = deserializeManifest(binary);

    expect(deserialized.sourceArchiveSha256).toBe(dummySha256A);
    expect(deserialized.targetArchiveSha256).toBe(dummySha256B);
    expect(deserialized.targetTotalUncompressedBytes).toBe(131072);
    expect(deserialized.entries.length).toBe(2);

    // Entry 1
    const e1 = deserialized.entries[0];
    expect(e1.filename).toBe("textures/hero.png");
    expect(e1.compressionMethod).toBe(8);
    expect(e1.repackMode).toBe("standard");
    expect(e1.uncompressedSize).toBe(65536);
    expect(e1.compressedSize).toBe(32768);
    expect(e1.crc32).toBe(0x12345678);
    expect(e1.alignmentPadding).toBe(4);
    expect(e1.opcodes).toEqual([
      {
        type: "COPY",
        sourceOffset: 0,
        length: 8192,
        chunkHash: dummyChunkHash1,
      },
      {
        type: "PATCH",
        sourceOffset: 8192,
        length: 8192,
        deltaOffset: 0,
        deltaLength: 4,
        chunkHash: dummyChunkHash2,
      },
    ]);

    // Entry 2
    const e2 = deserialized.entries[1];
    expect(e2.filename).toBe("audio/theme.wav");
    expect(e2.compressionMethod).toBe(0);
    expect(e2.repackMode).toBe("bit_preserving");
    expect(e2.uncompressedSize).toBe(65536);
    expect(e2.compressedSize).toBe(65536);
    expect(e2.crc32).toBe(0x87654321);
    expect(e2.alignmentPadding).toBe(0);
    expect(e2.opcodes).toEqual([
      {
        type: "INSERT",
        payloadOffset: 4,
        length: 4,
        chunkHash: dummyChunkHash3,
      },
    ]);

    // Raw payload pool
    expect(deserialized.rawPayloadSize).toBe(8);
    expect(deserialized.rawPayloadPool).toBeDefined();
    expect(Array.from(deserialized.rawPayloadPool!)).toEqual(Array.from(payload));
  });

  describe("Chaos and Failure Modes", () => {
    it("throws InvalidManifestError if buffer is smaller than minimum header", () => {
      const tinyBuf = new Uint8Array(20);
      expect(() => deserializeManifest(tinyBuf)).toThrow(InvalidManifestError);
      expect(() => deserializeManifest(tinyBuf)).toThrow(/smaller than minimum/);
    });

    it("throws InvalidManifestError if magic bytes do not match PAKD", () => {
      const manifest: DeltaRecipeManifest = {
        magic: "PAKD",
        version: "1.0.0",
        sourceArchiveSha256: dummySha256A,
        targetArchiveSha256: dummySha256B,
        targetTotalUncompressedBytes: 0,
        entries: [],
        rawPayloadSize: 0,
        rawPayloadPool: new Uint8Array(0),
      };

      const binary = serializeManifest(manifest);
      binary[0] = 0x00; // Corrupt magic
      expect(() => deserializeManifest(binary)).toThrow(InvalidManifestError);
      expect(() => deserializeManifest(binary)).toThrow(/Invalid manifest magic/);
    });

    it("throws InvalidManifestError if version is unsupported", () => {
      const manifest: DeltaRecipeManifest = {
        magic: "PAKD",
        version: "1.0.0",
        sourceArchiveSha256: dummySha256A,
        targetArchiveSha256: dummySha256B,
        targetTotalUncompressedBytes: 0,
        entries: [],
        rawPayloadSize: 0,
        rawPayloadPool: new Uint8Array(0),
      };

      const binary = serializeManifest(manifest);
      binary[4] = 99; // Corrupt version to 99
      expect(() => deserializeManifest(binary)).toThrow(InvalidManifestError);
      expect(() => deserializeManifest(binary)).toThrow(/Unsupported manifest version: 99/);
    });

    it("throws InvalidManifestError if hex string is not 64 characters during serialization", () => {
      const manifest: DeltaRecipeManifest = {
        magic: "PAKD",
        version: "1.0.0",
        sourceArchiveSha256: "abc",
        targetArchiveSha256: dummySha256B,
        targetTotalUncompressedBytes: 0,
        entries: [],
        rawPayloadSize: 0,
        rawPayloadPool: new Uint8Array(0),
      };

      expect(() => serializeManifest(manifest)).toThrow(InvalidManifestError);
      expect(() => serializeManifest(manifest)).toThrow(/Expected 64-character hex string/);
    });

    it("throws InvalidManifestError if unknown opcode tag is encountered", () => {
      const manifest: DeltaRecipeManifest = {
        magic: "PAKD",
        version: "1.0.0",
        sourceArchiveSha256: dummySha256A,
        targetArchiveSha256: dummySha256B,
        targetTotalUncompressedBytes: 8192,
        entries: [
          {
            filename: "file.bin",
            compressionMethod: 0,
            repackMode: "standard",
            uncompressedSize: 8192,
            compressedSize: 8192,
            crc32: 0,
            alignmentPadding: 0,
            opcodes: [
              {
                type: "COPY",
                sourceOffset: 0,
                length: 8192,
                chunkHash: dummyChunkHash1,
              },
            ],
          },
        ],
        rawPayloadSize: 0,
        rawPayloadPool: new Uint8Array(0),
      };

      const binary = serializeManifest(manifest);

      // Find the opcode type tag byte (it is after header, 2 hashes, uncompressedSize, entryCount, pathLen, path, flags, sizes, crc, padding, opcodeCount)
      // The opcode type tag in this serialization is 0 (COPY). Let's corrupt it to 42.
      // Search for dummyChunkHash1 in binary:
      const chunkHashByte0 = 0xaa;
      let tagOffset = -1;
      for (let i = 70; i < binary.length - 33; i++) {
        if (binary[i + 1] === chunkHashByte0 && binary[i + 2] === chunkHashByte0) {
          tagOffset = i;
          break;
        }
      }
      expect(tagOffset).toBeGreaterThan(0);
      binary[tagOffset] = 42; // Invalid opcode tag

      expect(() => deserializeManifest(binary)).toThrow(InvalidManifestError);
      expect(() => deserializeManifest(binary)).toThrow(/Unknown opcode type tag: 42/);
    });
  });
});
