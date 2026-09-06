import { describe, it, expect } from "vitest";
import { findAndParseEOCD, EOCD_SIGNATURE } from "../../../src/archive/eocd.js";
import { MemoryBinaryReader } from "../../../src/archive/binaryReader.js";
import { InvalidArchiveHeaderError } from "../../../src/archive/errors.js";
import { buildSyntheticArchive, generateSyntheticPayload } from "../../fixtures/syntheticArchive.js";

describe("EOCD Locator and Parser", () => {
  it("should locate and parse EOCD with 0 comment bytes", async () => {
    const archive = await buildSyntheticArchive({
      entries: [{ name: "test.txt", data: generateSyntheticPayload(128, 1) }],
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);

    expect(eocd.totalEntries).toBe(1);
    expect(eocd.commentLength).toBe(0);
    expect(eocd.centralDirectoryOffset).toBe(archive.centralDirectoryOffset);
    expect(eocd.centralDirectorySize).toBe(archive.centralDirectorySize);
  });

  it("should locate and parse EOCD with variable comment bytes", async () => {
    const commentText = "Custom archive build #4182 with metadata";
    const commentBytes = new TextEncoder().encode(commentText);

    const archive = await buildSyntheticArchive({
      entries: [{ name: "test.txt", data: generateSyntheticPayload(128, 2) }],
      comment: commentBytes,
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);

    expect(eocd.totalEntries).toBe(1);
    expect(eocd.commentLength).toBe(commentBytes.length);
    expect(new TextDecoder().decode(eocd.comment)).toBe(commentText);
  });

  it("should locate and parse EOCD with large 65535-byte comment", async () => {
    const largeComment = new Uint8Array(65535);
    largeComment.fill(0x5A); // 'Z'

    const archive = await buildSyntheticArchive({
      entries: [{ name: "test.txt", data: generateSyntheticPayload(64, 3) }],
      comment: largeComment,
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);

    expect(eocd.commentLength).toBe(65535);
    expect(eocd.comment[0]).toBe(0x5A);
    expect(eocd.comment[65534]).toBe(0x5A);
  });

  it("should throw InvalidArchiveHeaderError if archive is smaller than 22 bytes", async () => {
    const tinyBuffer = new Uint8Array(21);
    const reader = new MemoryBinaryReader(tinyBuffer);

    await expect(findAndParseEOCD(reader)).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("should throw InvalidArchiveHeaderError if EOCD signature is missing", async () => {
    const dummyBuffer = new Uint8Array(100);
    dummyBuffer.fill(0xAA);
    const reader = new MemoryBinaryReader(dummyBuffer);

    await expect(findAndParseEOCD(reader)).rejects.toThrow(InvalidArchiveHeaderError);
  });

  it("should disambiguate false EOCD signature embedded in comment bytes", async () => {
    // Construct comment containing the exact 4-byte signature 0x06054b50 followed by mismatched lengths
    const falseSignatureComment = new Uint8Array(50);
    const commentView = new DataView(falseSignatureComment.buffer);
    commentView.setUint32(10, EOCD_SIGNATURE, true); // False signature at offset 10
    commentView.setUint16(30, 999, true); // Invalid comment length at offset 10 + 20

    const archive = await buildSyntheticArchive({
      entries: [{ name: "test.txt", data: generateSyntheticPayload(64, 4) }],
      comment: falseSignatureComment,
    });

    const reader = new MemoryBinaryReader(archive.bytes);
    const eocd = await findAndParseEOCD(reader);

    // The real EOCD must be correctly identified
    expect(eocd.commentLength).toBe(50);
    expect(eocd.totalEntries).toBe(1);
  });

  it("should throw InvalidArchiveHeaderError if Central Directory overlaps with EOCD", async () => {
    const archive = await buildSyntheticArchive({
      entries: [{ name: "test.txt", data: generateSyntheticPayload(64, 5) }],
    });

    // Corrupt the EOCD record to claim Central Directory offset is beyond EOCD
    const corruptedBytes = new Uint8Array(archive.bytes);
    const view = new DataView(corruptedBytes.buffer);
    // Find real EOCD offset
    const eocdPos = corruptedBytes.length - 22;
    // Set central directory offset to eocdPos + 10
    view.setUint32(eocdPos + 16, eocdPos + 10, true);

    const reader = new MemoryBinaryReader(corruptedBytes);
    await expect(findAndParseEOCD(reader)).rejects.toThrow(InvalidArchiveHeaderError);
  });
});
