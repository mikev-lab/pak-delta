import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { MemoryBinaryReader } from "../../src/archive/binaryReader.js";
import { indexArchive } from "../../src/archive/indexer.js";
import {
  buildSyntheticArchive,
  generateSyntheticPayload,
} from "../fixtures/syntheticArchive.js";
import { generateDeltaRecipe } from "../../src/diff/matcher.js";
import { serializeManifest, deserializeManifest } from "../../src/diff/manifest.js";
import { reconstituteArchive, reconstituteArchiveToFile } from "../../src/repack/assembler.js";
import { computeChunkHashSync } from "../../src/chunker/fingerprint.js";

describe("Deterministic Repack & Client Reconstitution Pipeline (Integration)", () => {
  it("reconstitutes target archive with 100% byte-for-byte SHA-256 parity", async () => {
    // 1. Create baseline archive with 3 files
    const asset1V1 = generateSyntheticPayload(32768, 101);
    const asset2V1 = generateSyntheticPayload(49152, 102);
    const asset3V1 = generateSyntheticPayload(16384, 103);

    const baseline = await buildSyntheticArchive({
      entries: [
        { name: "textures/character.png", data: asset1V1 },
        { name: "audio/bgm.ogg", data: asset2V1 },
        { name: "scripts/ai.bin", data: asset3V1 },
      ],
    });

    // 2. Create target archive:
    // - asset1 modified (localized 20-byte change)
    // - asset2 renamed to audio/theme_remastered.ogg
    // - asset4 added (novel file)
    const asset1V2 = new Uint8Array(asset1V1);
    for (let i = 5000; i < 5020; i++) asset1V2[i] = (asset1V2[i] ^ 0xFF) & 0xFF;
    const asset4 = generateSyntheticPayload(20480, 104);

    const target = await buildSyntheticArchive({
      entries: [
        { name: "textures/character.png", data: asset1V2 },
        { name: "audio/theme_remastered.ogg", data: asset2V1 }, // Renamed from bgm.ogg
        { name: "levels/map01.pak", data: asset4 }, // Novel file
      ],
    });

    const sourceReader = new MemoryBinaryReader(baseline.bytes);
    const targetReader = new MemoryBinaryReader(target.bytes);

    const sourceIndex = await indexArchive(sourceReader);
    const targetIndex = await indexArchive(targetReader);

    // 3. Generate Delta Recipe Manifest
    const recipe = await generateDeltaRecipe(
      sourceReader,
      sourceIndex,
      targetReader,
      targetIndex
    );

    // 4. Binary serialization and deserialization round-trip
    const binaryManifest = serializeManifest(recipe);
    const deserializedManifest = deserializeManifest(binaryManifest);

    // 5. Client Reconstitution
    const reconstitutedBytes = await reconstituteArchive(sourceReader, deserializedManifest);

    // 6. Assert Exact Byte-for-Byte Target SHA-256 Parity!
    const reconstitutedSha256 = computeChunkHashSync(reconstitutedBytes);
    expect(reconstitutedSha256).toBe(targetIndex.archiveSha256);
    expect(reconstitutedBytes.length).toBe(target.bytes.length);
  });

  it("preserves 4096-byte Unreal DMA sector alignment padding byte-for-byte", async () => {
    const payload1 = generateSyntheticPayload(20000, 201);
    const payload2 = generateSyntheticPayload(15000, 202);

    const baseline = await buildSyntheticArchive({
      entries: [
        { name: "mesh/hero.uasset", data: payload1 },
        { name: "mesh/hero_lod.uasset", data: payload2 },
      ],
      sectorAlignment: 4096, // Unreal Engine 4 KB DMA sector alignment
    });

    const target = await buildSyntheticArchive({
      entries: [
        { name: "mesh/hero.uasset", data: payload1 },
        { name: "mesh/hero_lod.uasset", data: payload2 },
      ],
      sectorAlignment: 4096,
    });

    const sourceReader = new MemoryBinaryReader(baseline.bytes);
    const targetReader = new MemoryBinaryReader(target.bytes);

    const sourceIndex = await indexArchive(sourceReader);
    const targetIndex = await indexArchive(targetReader);

    const recipe = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);
    const binary = serializeManifest(recipe);
    const manifest = deserializeManifest(binary);

    const reconstituted = await reconstituteArchive(sourceReader, manifest);
    const reconstitutedSha256 = computeChunkHashSync(reconstituted);

    expect(reconstitutedSha256).toBe(targetIndex.archiveSha256);
  });

  it("supports file-to-file atomic reconstitution on disk", async () => {
    const payload = generateSyntheticPayload(10000, 301);

    const baseline = await buildSyntheticArchive({
      entries: [{ name: "config.dat", data: payload }],
    });

    const target = await buildSyntheticArchive({
      entries: [{ name: "config.dat", data: payload }],
    });

    const sourceReader = new MemoryBinaryReader(baseline.bytes);
    const targetReader = new MemoryBinaryReader(target.bytes);

    const sourceIndex = await indexArchive(sourceReader);
    const targetIndex = await indexArchive(targetReader);

    const recipe = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);
    const binary = serializeManifest(recipe);
    const manifest = deserializeManifest(binary);

    const testDir = join(process.cwd(), "scratch");
    const targetFilePath = join(testDir, "test_reconstituted.pak");

    await reconstituteArchiveToFile(sourceReader, manifest, targetFilePath);

    const writtenBytes = await fs.readFile(targetFilePath);
    const writtenSha256 = computeChunkHashSync(writtenBytes);

    expect(writtenSha256).toBe(targetIndex.archiveSha256);

    // Clean up temporary test file
    await fs.unlink(targetFilePath);
  });

  it("reconstitutes non-standard Level 1 fast-compressed entries via bit-preserving mode with 100% target SHA-256 parity", async () => {
    const { deflateRawSync } = await import("node:zlib");
    const payload = generateSyntheticPayload(65536, 401);

    // Target archive entry is compressed using non-standard Level 1 compression (Fast mode)
    const level1Compressed = deflateRawSync(payload, { level: 1 });

    const baseline = await buildSyntheticArchive({
      entries: [{ name: "level1_asset.pak", data: payload }],
    });

    const target = await buildSyntheticArchive({
      entries: [
        {
          name: "level1_asset.pak",
          data: payload,
          customCompressedData: level1Compressed,
        },
      ],
    });

    const sourceReader = new MemoryBinaryReader(baseline.bytes);
    const targetReader = new MemoryBinaryReader(target.bytes);

    const sourceIndex = await indexArchive(sourceReader);
    const targetIndex = await indexArchive(targetReader);

    const recipe = await generateDeltaRecipe(sourceReader, sourceIndex, targetReader, targetIndex);
    expect(recipe.entries[0].repackMode).toBe("bit_preserving");

    const binary = serializeManifest(recipe);
    const manifest = deserializeManifest(binary);

    const reconstituted = await reconstituteArchive(sourceReader, manifest);
    const reconstitutedSha256 = computeChunkHashSync(reconstituted);

    expect(reconstitutedSha256).toBe(targetIndex.archiveSha256);
  });
});
