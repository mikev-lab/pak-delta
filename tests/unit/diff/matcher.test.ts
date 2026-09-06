import { describe, it, expect } from "vitest";
import { generateDeltaRecipe } from "../../../src/diff/matcher.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { indexArchive } from "../../../src/archive/indexer.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("Delta Matcher and Recipe Generator", () => {
  it("should generate 100% COPY opcodes and zero payload bytes for identical archives", async () => {
    const payload = generateSyntheticPayload(32768, 555);
    const archive = await buildSyntheticArchive({
      entries: [{ name: "level.pak", data: payload, compressed: true }],
    });

    const sourceReader = new MemoryBinaryReader(archive.bytes);
    const sourceIndex = await indexArchive(archive.bytes);

    const targetReader = new MemoryBinaryReader(archive.bytes);
    const targetIndex = await indexArchive(archive.bytes);

    const manifest = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);

    expect(manifest.entries.length).toBe(1);
    expect(manifest.rawPayloadSize).toBe(0);
    expect(manifest.entries[0].opcodes.length).toBeGreaterThan(0);

    for (const op of manifest.entries[0].opcodes) {
      expect(op.type).toBe("COPY");
    }
  });

  it("should emit PATCH opcodes for localized chunk modifications", async () => {
    const size = 32768;
    const sourcePayload = generateSyntheticPayload(size, 777);
    const targetPayload = new Uint8Array(sourcePayload);
    // Mutate 15 bytes in the first 4 KB
    for (let i = 1000; i < 1015; i++) {
      targetPayload[i] = 0xAA;
    }

    const sourceArchive = await buildSyntheticArchive({
      entries: [{ name: "data.bin", data: sourcePayload, compressed: true }],
    });
    const targetArchive = await buildSyntheticArchive({
      entries: [{ name: "data.bin", data: targetPayload, compressed: true }],
    });

    const sourceReader = new MemoryBinaryReader(sourceArchive.bytes);
    const sourceIndex = await indexArchive(sourceArchive.bytes);

    const targetReader = new MemoryBinaryReader(targetArchive.bytes);
    const targetIndex = await indexArchive(targetArchive.bytes);

    const manifest = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);

    expect(manifest.entries.length).toBe(1);
    // There must be at least one PATCH opcode and multiple COPY opcodes
    const opcodes = manifest.entries[0].opcodes;
    const patchOps = opcodes.filter((op) => op.type === "PATCH");
    const copyOps = opcodes.filter((op) => op.type === "COPY");

    expect(patchOps.length).toBeGreaterThan(0);
    expect(copyOps.length).toBeGreaterThan(0);
    // Payload size must be tiny (span delta bytes), far smaller than transmitting full chunk
    expect(manifest.rawPayloadSize).toBeLessThan(100);
  });

  it("should emit COPY opcodes across renamed and relocated assets via Global Merkle Index", async () => {
    const assetPayload = generateSyntheticPayload(32768, 888);

    const sourceArchive = await buildSyntheticArchive({
      entries: [{ name: "Original/Path/Mesh.bin", data: assetPayload, compressed: true }],
    });
    const targetArchive = await buildSyntheticArchive({
      entries: [{ name: "NewFolder/Relocated/RenamedMesh.bin", data: assetPayload, compressed: true }],
    });

    const sourceReader = new MemoryBinaryReader(sourceArchive.bytes);
    const sourceIndex = await indexArchive(sourceArchive.bytes);

    const targetReader = new MemoryBinaryReader(targetArchive.bytes);
    const targetIndex = await indexArchive(targetArchive.bytes);

    const manifest = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);

    expect(manifest.entries.length).toBe(1);
    expect(manifest.entries[0].filename).toBe("NewFolder/Relocated/RenamedMesh.bin");
    expect(manifest.rawPayloadSize).toBe(0); // 0 bytes downloaded for relocated asset

    for (const op of manifest.entries[0].opcodes) {
      expect(op.type).toBe("COPY");
    }
  });

  it("should emit INSERT opcodes for completely novel assets", async () => {
    const sourcePayload = generateSyntheticPayload(8192, 100);
    const novelPayload = generateSyntheticPayload(8192, 999);

    const sourceArchive = await buildSyntheticArchive({
      entries: [{ name: "base.bin", data: sourcePayload, compressed: true }],
    });
    const targetArchive = await buildSyntheticArchive({
      entries: [{ name: "novel.bin", data: novelPayload, compressed: true }],
    });

    const sourceReader = new MemoryBinaryReader(sourceArchive.bytes);
    const sourceIndex = await indexArchive(sourceArchive.bytes);

    const targetReader = new MemoryBinaryReader(targetArchive.bytes);
    const targetIndex = await indexArchive(targetArchive.bytes);

    const manifest = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);

    expect(manifest.entries.length).toBe(1);
    const insertOps = manifest.entries[0].opcodes.filter((op) => op.type === "INSERT");
    expect(insertOps.length).toBeGreaterThan(0);
    expect(manifest.rawPayloadSize).toBeGreaterThan(0);
  });
});
