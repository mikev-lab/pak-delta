/**
 * High-level archive indexer and container slicer.
 * Slices container files back-to-front, isolates DMA sector alignment padding,
 * and extracts entry slices with bounded memory consumption.
 */

import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ArchiveEntrySlice } from "../types.js";
import { type IBinaryReader, MemoryBinaryReader, FileHandleBinaryReader } from "./binaryReader.js";
import { findAndParseEOCD, type EOCDRecord } from "./eocd.js";
import { parseCentralDirectory, type CentralDirectoryEntry } from "./centralDirectory.js";
import { readLocalFileHeader } from "./localHeader.js";
import { InvalidArchiveHeaderError } from "./errors.js";

export interface ContainerIndex {
  archiveSha256: string;
  totalEntries: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  commentLength: number;
  slices: ArchiveEntrySlice[];
}

/**
 * Computes SHA-256 hash of reader content in bounded 64 KB streaming windows.
 */
export async function computeArchiveSha256(reader: IBinaryReader): Promise<string> {
  const hash = createHash("sha256");
  const windowSize = 65536; // 64 KB streaming window
  let offset = 0;
  while (offset < reader.size) {
    const length = Math.min(windowSize, reader.size - offset);
    const chunk = await reader.readAt(offset, length);
    hash.update(chunk);
    offset += length;
  }
  return hash.digest("hex");
}

/**
 * Indexes an archive from an in-memory Uint8Array, file path string, or IBinaryReader.
 */
export async function indexArchive(source: Uint8Array | string | IBinaryReader): Promise<ContainerIndex> {
  let reader: IBinaryReader;
  let fileHandleToClose: { close: () => Promise<void> } | null = null;

  if (typeof source === "string") {
    const handle = await open(source, "r");
    fileHandleToClose = handle;
    const stat = await handle.stat();
    reader = new FileHandleBinaryReader(handle, stat.size);
  } else if (source instanceof Uint8Array) {
    reader = new MemoryBinaryReader(source);
  } else {
    reader = source;
  }

  try {
    // 1. Locate and parse EOCD
    const eocd: EOCDRecord = await findAndParseEOCD(reader);

    // 2. Parse Central Directory headers
    const cdEntries: CentralDirectoryEntry[] = await parseCentralDirectory(
      reader,
      eocd.centralDirectoryOffset,
      eocd.centralDirectorySize,
      eocd.totalEntries
    );

    // 3. Sort entries physically by localHeaderOffset to evaluate contiguous layout
    const sortedEntries = [...cdEntries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);

    // 4. Inspect Local File Headers and calculate payload dataOffsets & sector padding
    const slices: ArchiveEntrySlice[] = [];

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      const lfh = await readLocalFileHeader(reader, entry.localHeaderOffset);

      // Verify header consistency
      if (lfh.filename !== entry.filename) {
        throw new InvalidArchiveHeaderError(
          `Local File Header filename '${lfh.filename}' does not match Central Directory filename '${entry.filename}' at offset ${entry.localHeaderOffset}`
        );
      }

      // Calculate payload end offset including trailing data descriptor if present
      const descriptorSize = entry.hasDataDescriptor ? 16 : 0;
      const entryPayloadEnd = lfh.dataOffset + entry.compressedSize + descriptorSize;

      // Calculate sector alignment padding to the next structure
      let alignmentPadding = 0;
      if (i + 1 < sortedEntries.length) {
        const nextLocalOffset = sortedEntries[i + 1].localHeaderOffset;
        if (nextLocalOffset < entryPayloadEnd) {
          throw new InvalidArchiveHeaderError(
            `Overlapping entries detected: entry '${entry.filename}' ends at ${entryPayloadEnd}, but next entry begins at ${nextLocalOffset}`
          );
        }
        alignmentPadding = nextLocalOffset - entryPayloadEnd;
      } else {
        // Last entry aligns against the Central Directory
        if (eocd.centralDirectoryOffset < entryPayloadEnd) {
          throw new InvalidArchiveHeaderError(
            `Final entry '${entry.filename}' payload end ${entryPayloadEnd} exceeds Central Directory offset ${eocd.centralDirectoryOffset}`
          );
        }
        alignmentPadding = eocd.centralDirectoryOffset - entryPayloadEnd;
      }

      slices.push({
        index: entry.index,
        filename: entry.filename,
        compressionMethod: entry.compressionMethod,
        localHeaderOffset: entry.localHeaderOffset,
        dataOffset: lfh.dataOffset,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        crc32: entry.crc32,
        extraFieldLength: entry.extraFieldLength,
        alignmentPadding,
        hasDataDescriptor: entry.hasDataDescriptor,
      });
    }

    // Sort slices back to original Central Directory logical order
    slices.sort((a, b) => a.index - b.index);

    // 5. Compute archive SHA-256 hash
    const archiveSha256 = await computeArchiveSha256(reader);

    return {
      archiveSha256,
      totalEntries: eocd.totalEntries,
      centralDirectoryOffset: eocd.centralDirectoryOffset,
      centralDirectorySize: eocd.centralDirectorySize,
      commentLength: eocd.commentLength,
      slices,
    };
  } finally {
    if (fileHandleToClose) {
      await fileHandleToClose.close();
    }
  }
}
