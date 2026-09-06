import { describe, it, expect } from "vitest";
import { encodeULEB128, decodeULEB128 } from "../../../src/diff/leb128.js";

describe("uLEB128 Variable-Length Integer Serialization", () => {
  it("should encode and decode small integers in a single byte", () => {
    const testCases = [0, 1, 42, 127];
    for (const val of testCases) {
      const encoded = encodeULEB128(val);
      expect(encoded.length).toBe(1);
      const decoded = decodeULEB128(encoded, 0);
      expect(decoded.value).toBe(val);
      expect(decoded.bytesRead).toBe(1);
    }
  });

  it("should encode and decode multi-byte integers accurately", () => {
    const testCases = [128, 255, 300, 16384, 65535, 1000000, 52428800];
    for (const val of testCases) {
      const encoded = encodeULEB128(val);
      expect(encoded.length).toBeGreaterThan(1);
      const decoded = decodeULEB128(encoded, 0);
      expect(decoded.value).toBe(val);
      expect(decoded.bytesRead).toBe(encoded.length);
    }
  });

  it("should decode from non-zero offsets within a buffer", () => {
    const prefix = new Uint8Array([0xAA, 0xBB]);
    const num = encodeULEB128(9999);
    const combined = new Uint8Array(prefix.length + num.length);
    combined.set(prefix, 0);
    combined.set(num, prefix.length);

    const decoded = decodeULEB128(combined, 2);
    expect(decoded.value).toBe(9999);
    expect(decoded.bytesRead).toBe(num.length);
  });

  it("should throw RangeError on negative or non-finite inputs", () => {
    expect(() => encodeULEB128(-1)).toThrow(RangeError);
    expect(() => encodeULEB128(Infinity)).toThrow(RangeError);
    expect(() => encodeULEB128(NaN)).toThrow(RangeError);
  });

  it("should throw RangeError on out-of-bounds decode offset", () => {
    const buf = new Uint8Array([1, 2]);
    expect(() => decodeULEB128(buf, -1)).toThrow(RangeError);
    expect(() => decodeULEB128(buf, 5)).toThrow(RangeError);
  });

  it("should throw RangeError on truncated buffer without terminal byte", () => {
    // 0x80 has continuation bit set, expecting another byte
    const truncatedBuf = new Uint8Array([0x80]);
    expect(() => decodeULEB128(truncatedBuf, 0)).toThrow(RangeError);
  });
});
