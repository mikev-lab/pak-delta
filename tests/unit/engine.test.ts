import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  createDelta,
  createDeltaManifest,
  applyDelta,
  applyDeltaToFile,
} from "../../src/engine.js";
import {
  buildSyntheticArchive,
  createProceduralAsset,
  applyMutation,
} from "../fixtures/syntheticArchive.js";
import { computeChunkHashSync } from "../../src/chunker/fingerprint.js";

describe("High-Level Engine Facade", () => {
  it("creates and applies binary delta with in-memory buffers", async () => {
    const tex1 = createProceduralAsset("texture", 32768, 501);
    const audio1 = createProceduralAsset("audio", 24576, 502);

    const baseline = await buildSyntheticArchive({
      entries: [
        { name: "textures/grass.png", data: tex1 },
        { name: "audio/sfx.wav", data: audio1 },
      ],
    });

    // Mutate texture slightly (12-byte localized edit)
    const tex2 = applyMutation(tex1, {
      type: "modify",
      offset: 4096,
      length: 12,
    });

    const target = await buildSyntheticArchive({
      entries: [
        { name: "textures/grass.png", data: tex2 },
        { name: "audio/sfx.wav", data: audio1 },
      ],
    });

    // 1. Create binary delta
    const deltaBytes = await createDelta(baseline.bytes, target.bytes);
    expect(deltaBytes.byteLength).toBeGreaterThan(0);

    // 2. Apply delta
    const reconstituted = await applyDelta(baseline.bytes, deltaBytes);
    const reconstitutedHash = computeChunkHashSync(reconstituted);
    const targetHash = computeChunkHashSync(target.bytes);

    expect(reconstitutedHash).toBe(targetHash);
  });

  it("creates and applies structured DeltaRecipeManifest", async () => {
    const code = createProceduralAsset("bytecode", 16384, 601);
    const config = createProceduralAsset("config", 8192, 602);

    const baseline = await buildSyntheticArchive({
      entries: [
        { name: "scripts/main.luac", data: code },
        { name: "settings.json", data: config },
      ],
    });

    const target = await buildSyntheticArchive({
      entries: [
        { name: "scripts/main.luac", data: code },
        { name: "settings.json", data: config },
      ],
    });

    const manifest = await createDeltaManifest(baseline.bytes, target.bytes);
    expect(manifest.magic).toBe("PAKD");
    expect(manifest.entries.length).toBe(2);

    // Apply manifest directly
    const reconstituted = await applyDelta(baseline.bytes, manifest);
    expect(computeChunkHashSync(reconstituted)).toBe(computeChunkHashSync(target.bytes));
  });

  it("creates and applies delta using disk file paths", async () => {
    const asset = createProceduralAsset("texture", 16384, 701);
    const baseline = await buildSyntheticArchive({
      entries: [{ name: "asset.bin", data: asset }],
    });
    const target = await buildSyntheticArchive({
      entries: [{ name: "asset.bin", data: asset }],
    });

    const testDir = join(process.cwd(), "scratch");
    await fs.mkdir(testDir, { recursive: true });
    const baselinePath = join(testDir, "engine_test_baseline.pak");
    const targetPath = join(testDir, "engine_test_target.pak");
    const outPath = join(testDir, "engine_test_out.pak");

    await fs.writeFile(baselinePath, baseline.bytes);
    await fs.writeFile(targetPath, target.bytes);

    try {
      // Create delta using string paths
      const deltaBytes = await createDelta(baselinePath, targetPath);

      // Apply delta directly to file
      await applyDeltaToFile(baselinePath, deltaBytes, outPath);

      const written = await fs.readFile(outPath);
      expect(computeChunkHashSync(written)).toBe(computeChunkHashSync(target.bytes));
    } finally {
      await fs.unlink(baselinePath).catch(() => {});
      await fs.unlink(targetPath).catch(() => {});
      await fs.unlink(outPath).catch(() => {});
    }
  });
});
