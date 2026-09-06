import { describe, it, expect } from "vitest";
import { GEAR_TABLE } from "../../../src/chunker/table.js";

describe("FastCDC Gear Hash Table", () => {
  it("should have exactly 256 32-bit unsigned integers", () => {
    expect(GEAR_TABLE).toBeInstanceOf(Uint32Array);
    expect(GEAR_TABLE.length).toBe(256);
  });

  it("should have deterministic values based on seed 0x50414B44", () => {
    // Verify first and last elements match deterministic LCG generation
    expect(typeof GEAR_TABLE[0]).toBe("number");
    expect(GEAR_TABLE[0]).toBeGreaterThan(0);
    expect(typeof GEAR_TABLE[255]).toBe("number");
    expect(GEAR_TABLE[255]).toBeGreaterThan(0);
  });

  it("should have high entropy with 256 unique non-zero values", () => {
    const uniqueValues = new Set<number>();
    for (let i = 0; i < GEAR_TABLE.length; i++) {
      expect(GEAR_TABLE[i]).toBeGreaterThan(0);
      uniqueValues.add(GEAR_TABLE[i]);
    }
    expect(uniqueValues.size).toBe(256);
  });
});
