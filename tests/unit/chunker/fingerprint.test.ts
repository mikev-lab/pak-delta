import { describe, it, expect } from "vitest";
import { computeChunkHash, computeChunkHashSync } from "../../../src/chunker/fingerprint.js";

describe("Chunk Fingerprinter", () => {
  it("should match standard SHA-256 test vectors", async () => {
    // Standard test vector: SHA-256 of empty string is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const emptyBuf = new Uint8Array(0);
    const asyncHashEmpty = await computeChunkHash(emptyBuf);
    const syncHashEmpty = computeChunkHashSync(emptyBuf);

    expect(asyncHashEmpty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(syncHashEmpty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    // Standard test vector: SHA-256 of "hello"
    const helloBuf = new TextEncoder().encode("hello");
    const asyncHashHello = await computeChunkHash(helloBuf);
    const syncHashHello = computeChunkHashSync(helloBuf);

    expect(asyncHashHello).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(syncHashHello).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("should have 100% parity between async Web Crypto and sync Node crypto on binary payloads", async () => {
    const payload = new Uint8Array(1024);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 37) & 0xFF;
    }

    const asyncHash = await computeChunkHash(payload);
    const syncHash = computeChunkHashSync(payload);

    expect(asyncHash).toBe(syncHash);
    expect(asyncHash.length).toBe(64);
  });
});
