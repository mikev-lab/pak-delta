import { describe, it, expect } from "vitest";
import { MemoryBinaryReader } from "../../src/archive/binaryReader.js";
import { indexArchive } from "../../src/archive/indexer.js";
import {
  InvalidArchiveHeaderError,
  TruncatedArchiveError,
  DeflateCorruptionError,
} from "../../src/archive/errors.js";
import {
  buildSyntheticArchive,
  createProceduralAsset,
} from "../fixtures/syntheticArchive.js";
import { createDelta, applyDelta } from "../../src/engine.js";
import {
  BaselineSha256MismatchError,
  ChunkHashMismatchError,
} from "../../src/repack/errors.js";
import { InvalidManifestError } from "../../src/diff/errors.js";

describe("Chaos Engineering: Corruption and Failure Resilience", () => {
  it("throws InvalidArchiveHeaderError when archive is truncated before EOCD", async () => {
    const asset = createProceduralAsset("texture", 10000, 801);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "tex.png", data: asset }],
    });

    // Truncate archive by removing the trailing 40 bytes (removes EOCD)
    const truncated = archive.bytes.subarray(0, archive.bytes.length - 40);
    const reader = new MemoryBinaryReader(truncated);

    await expect(() => indexArchive(reader)).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("throws TruncatedArchiveError when archive is truncated within a slice payload", async () => {
    const asset = createProceduralAsset("texture", 10000, 802);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "tex.png", data: asset }],
    });

    // Truncate reader size assertion
    const reader = new MemoryBinaryReader(archive.bytes.subarray(0, 50));
    await expect(() => reader.readAt(0, 100)).rejects.toThrow(TruncatedArchiveError);
  });

  it("throws DeflateCorruptionError when DEFLATE stream is corrupted", async () => {
    const asset = createProceduralAsset("texture", 10000, 803);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "tex.png", data: asset, compressed: true }],
    });

    // Corrupt compressed payload bytes
    const corruptBytes = new Uint8Array(archive.bytes);
    const record = archive.records[0];
    for (let i = record.dataOffset + 2; i < record.dataOffset + 12; i++) {
      corruptBytes[i] = 0xFF;
    }

    const corruptReader = new MemoryBinaryReader(corruptBytes);
    const index = await indexArchive(corruptReader);

    const { inflateEntrySliceToBuffer } = await import("../../src/archive/inflater.js");
    await expect(() => inflateEntrySliceToBuffer(corruptReader, index.slices[0])).rejects.toThrow(
      DeflateCorruptionError
    );
  });

  it("throws InvalidManifestError when delta manifest binary has corrupted magic bytes", async () => {
    const asset = createProceduralAsset("config", 4096, 804);
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "cfg.json", data: asset }],
    });

    const deltaBytes = await createDelta(baseline.bytes, baseline.bytes);
    const corruptDelta = new Uint8Array(deltaBytes);
    corruptDelta[0] = 0x00; // Corrupt magic

    await expect(() => applyDelta(baseline.bytes, corruptDelta)).rejects.toThrow(
      InvalidManifestError
    );
  });

  it("throws ChunkHashMismatchError when single-bit flip is injected into manifest raw payload", async () => {
    const asset1 = createProceduralAsset("texture", 8192, 805);
    const asset2 = createProceduralAsset("texture", 8192, 806);

    const baseline = await buildSyntheticArchive({
      entries: [{ name: "file1.bin", data: asset1 }],
    });
    const target = await buildSyntheticArchive({
      entries: [{ name: "file2.bin", data: asset2 }], // Novel asset
    });

    const deltaBytes = await createDelta(baseline.bytes, target.bytes);
    const corruptDelta = new Uint8Array(deltaBytes);

    // Invert a bit near the end of the delta manifest (inside the raw payload pool)
    corruptDelta[corruptDelta.length - 10] ^= 0x01;

    await expect(() => applyDelta(baseline.bytes, corruptDelta)).rejects.toThrow(
      ChunkHashMismatchError
    );
  });

  it("throws BaselineSha256MismatchError when applying patch against incompatible baseline", async () => {
    const assetA = createProceduralAsset("bytecode", 8192, 807);
    const assetB = createProceduralAsset("bytecode", 8192, 808);

    const baseline1 = await buildSyntheticArchive({
      entries: [{ name: "code.bin", data: assetA }],
    });
    const baseline2 = await buildSyntheticArchive({
      entries: [{ name: "code.bin", data: assetB }],
    });

    const delta = await createDelta(baseline1.bytes, baseline1.bytes);

    // Attempt to apply delta on wrong baseline
    await expect(() => applyDelta(baseline2.bytes, delta)).rejects.toThrow(
      BaselineSha256MismatchError
    );
  });
});
