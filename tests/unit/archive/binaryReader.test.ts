import { describe, it, expect } from "vitest";
import { open, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryBinaryReader, FileHandleBinaryReader } from "../../../src/archive/binaryReader.js";
import { TruncatedArchiveError } from "../../../src/archive/errors.js";

describe("Binary Readers", () => {
  describe("MemoryBinaryReader", () => {
    it("should read slices accurately within bounds", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const reader = new MemoryBinaryReader(data);
      expect(reader.size).toBe(5);

      const slice = await reader.readAt(1, 3);
      expect(Array.from(slice)).toEqual([20, 30, 40]);
    });

    it("should throw TruncatedArchiveError on negative offset or length", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const reader = new MemoryBinaryReader(data);

      await expect(reader.readAt(-1, 2)).rejects.toThrow(TruncatedArchiveError);
      await expect(reader.readAt(0, -1)).rejects.toThrow(TruncatedArchiveError);
    });

    it("should throw TruncatedArchiveError when reading beyond buffer size", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const reader = new MemoryBinaryReader(data);

      await expect(reader.readAt(2, 5)).rejects.toThrow(TruncatedArchiveError);
    });
  });

  describe("FileHandleBinaryReader", () => {
    it("should read slices accurately from a disk file", async () => {
      const tempPath = join(tmpdir(), `test-file-reader-${Date.now()}.bin`);
      const testBytes = new Uint8Array([100, 101, 102, 103, 104, 105]);
      await writeFile(tempPath, testBytes);

      const handle = await open(tempPath, "r");
      try {
        const reader = new FileHandleBinaryReader(handle, testBytes.length);
        expect(reader.size).toBe(6);

        const chunk = await reader.readAt(2, 3);
        expect(Array.from(chunk)).toEqual([102, 103, 104]);

        // Test boundary error conditions
        await expect(reader.readAt(-1, 2)).rejects.toThrow(TruncatedArchiveError);
        await expect(reader.readAt(0, -1)).rejects.toThrow(TruncatedArchiveError);
        await expect(reader.readAt(4, 5)).rejects.toThrow(TruncatedArchiveError);
      } finally {
        await handle.close();
        await unlink(tempPath).catch(() => {});
      }
    });

    it("should throw TruncatedArchiveError if file read returns fewer bytes than requested", async () => {
      // Mock a handle that returns partial reads
      const mockHandle = {
        read: async () => ({ bytesRead: 2 }),
      } as any;

      const reader = new FileHandleBinaryReader(mockHandle, 10);
      await expect(reader.readAt(0, 5)).rejects.toThrow(TruncatedArchiveError);
    });
  });
});
