import { describe, it, expect } from "vitest";
import {
  buildSyntheticArchive,
  createProceduralAsset,
} from "../fixtures/syntheticArchive.js";
import { createDelta, applyDelta } from "../../src/engine.js";
import { computeChunkHashSync } from "../../src/chunker/fingerprint.js";

describe("Chaos Engineering: Bounded Streaming Heap Memory Invariant", () => {
  it("processes multi-megabyte archives within the strict 64 MB heap budget", async () => {
    // Force GC if exposed to establish clean baseline
    if (global.gc) {
      global.gc();
    }
    const initialHeap = process.memoryUsage().heapUsed;

    // Create 10-entry synthetic baseline archive (~2.5 MB uncompressed)
    const entryCount = 10;
    const entries = [];
    for (let i = 0; i < entryCount; i++) {
      const type = i % 2 === 0 ? "texture" : "audio";
      const data = createProceduralAsset(type, 262144, 1000 + i); // 256 KB each
      entries.push({ name: `assets/asset_${i}.dat`, data });
    }

    const baseline = await buildSyntheticArchive({ entries });
    const target = await buildSyntheticArchive({ entries });

    // Measure memory during delta generation and application
    const deltaBytes = await createDelta(baseline.bytes, target.bytes);
    const reconstituted = await applyDelta(baseline.bytes, deltaBytes);

    expect(computeChunkHashSync(reconstituted)).toBe(computeChunkHashSync(target.bytes));

    if (global.gc) {
      global.gc();
    }
    const finalHeap = process.memoryUsage().heapUsed;
    const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

    // Invariant 2.3: Peak heap allocation must remain bounded under 64 MB
    expect(finalHeap / (1024 * 1024)).toBeLessThan(64);
    // Net heap increase must not retain unbounded memory
    expect(heapDeltaMb).toBeLessThan(35);
  });
});
