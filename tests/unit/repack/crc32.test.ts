import { describe, it, expect } from "vitest";
import { computeCrc32, Crc32Stream } from "../../../src/repack/crc32.js";

describe("IEEE 802.3 Bitwise CRC32 Engine", () => {
  it("computes standard IEEE 802.3 check values correctly", () => {
    // Standard test vector: "123456789" -> 0xCBF43926
    const testVector = new TextEncoder().encode("123456789");
    const crc = computeCrc32(testVector);
    expect(crc).toBe(0xCBF43926);

    // Empty buffer -> 0x00000000
    const empty = new Uint8Array(0);
    expect(computeCrc32(empty)).toBe(0);
  });

  it("produces identical results with Crc32Stream chunked accumulation", () => {
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 37 + 13) & 0xFF;
    }

    const expectedCrc = computeCrc32(data);

    // Accumulate in 128-byte chunks
    const stream = new Crc32Stream();
    for (let offset = 0; offset < data.length; offset += 128) {
      stream.update(data.subarray(offset, offset + 128));
    }

    expect(stream.digest()).toBe(expectedCrc);
  });

  it("supports reset() on Crc32Stream", () => {
    const data1 = new TextEncoder().encode("Hello");
    const data2 = new TextEncoder().encode("World");

    const stream = new Crc32Stream();
    stream.update(data1);
    expect(stream.digest()).toBe(computeCrc32(data1));

    stream.reset();
    stream.update(data2);
    expect(stream.digest()).toBe(computeCrc32(data2));
  });

  it("supports chained seed calculation", () => {
    const part1 = new TextEncoder().encode("pak-");
    const part2 = new TextEncoder().encode("delta");
    const full = new TextEncoder().encode("pak-delta");

    const fullCrc = computeCrc32(full);

    const crc1 = computeCrc32(part1);
    const chainedCrc = computeCrc32(part2, crc1);

    expect(chainedCrc).toBe(fullCrc);
  });
});
