import { describe, it, expect } from "vitest";
import { GlobalMerkleIndex, buildGlobalMerkleIndex } from "../../../src/diff/merkleIndex.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { indexArchive } from "../../../src/archive/indexer.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("Global Container Merkle Index", () => {
  it("should register and locate chunk fingerprints accurately", () => {
    const index = new GlobalMerkleIndex();
    expect(index.size).toBe(0);

    index.register("hash123", { sliceIndex: 0, offset: 0, length: 4096 });
    expect(index.size).toBe(1);
    expect(index.has("hash123")).toBe(true);
    expect(index.has("hashNotFound")).toBe(false);

    const loc = index.find("hash123");
    expect(loc).toEqual({ sliceIndex: 0, offset: 0, length: 4096 });
  });

  it("should not overwrite earlier locations when duplicate chunk hashes are registered", () => {
    const index = new GlobalMerkleIndex();
    index.register("duplicateHash", { sliceIndex: 0, offset: 0, length: 4096 });
    index.register("duplicateHash", { sliceIndex: 1, offset: 8192, length: 4096 });

    expect(index.size).toBe(1);
    expect(index.find("duplicateHash")?.sliceIndex).toBe(0);
  });

  it("should build container-wide Merkle index across multiple archive slices", async () => {
    const p1 = generateSyntheticPayload(16384, 111);
    const p2 = generateSyntheticPayload(32768, 222);

    const archive = await buildSyntheticArchive({
      entries: [
        { name: "assets/textures.bin", data: p1, compressed: true },
        { name: "assets/audio.bin", data: p2, compressed: true },
      ],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const containerIndex = await indexArchive(archive.bytes);

    const globalIndex = await buildGlobalMerkleIndex(reader, containerIndex.slices);
    expect(globalIndex.size).toBeGreaterThan(0);
  });
});
