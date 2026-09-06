/**
 * Streaming binary reader abstraction supporting both in-memory Uint8Array
 * and disk-backed FileHandle without reading monolithic archives into RAM.
 */

import type { FileHandle } from "node:fs/promises";
import { TruncatedArchiveError } from "./errors.js";

export interface IBinaryReader {
  readonly size: number;
  readAt(offset: number, length: number): Promise<Uint8Array>;
  close?(): Promise<void>;
}

export class MemoryBinaryReader implements IBinaryReader {
  readonly size: number;

  constructor(private readonly data: Uint8Array) {
    this.size = data.length;
  }

  async readAt(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new TruncatedArchiveError(
        `Requested range [${offset}, ${offset + length}) exceeds buffer size ${this.size}`
      );
    }
    return this.data.subarray(offset, offset + length);
  }
}

export class FileHandleBinaryReader implements IBinaryReader {
  constructor(private readonly handle: FileHandle, readonly size: number) {}

  async readAt(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new TruncatedArchiveError(
        `Requested range [${offset}, ${offset + length}) exceeds file size ${this.size}`
      );
    }
    const buffer = new Uint8Array(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, offset);
    if (bytesRead < length) {
      throw new TruncatedArchiveError(
        `Expected to read ${length} bytes at offset ${offset}, but only read ${bytesRead} bytes`
      );
    }
    return buffer;
  }
}
