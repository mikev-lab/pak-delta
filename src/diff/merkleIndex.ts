/**
 * Global Container Merkle Index.
 * Maps FastCDC chunk fingerprints across all container slices into an O(1) dictionary,
 * enabling cross-file deduplication for moved, renamed, and duplicated assets.
 */

import type { ArchiveEntrySlice } from "../types.js";
import type { IBinaryReader } from "../archive/binaryReader.js";
import { inflateEntrySlice } from "../archive/inflater.js";
import { chunkStream } from "../chunker/fastcdc.js";

export interface IndexedChunkLocation {
  sliceIndex: number;
  offset: number; // Uncompressed byte offset within the source entry
  length: number; // Byte length of the chunk
}

export class GlobalMerkleIndex {
  private readonly map = new Map<string, IndexedChunkLocation>();

  /**
   * Registers a chunk fingerprint into the global dictionary if not already present.
   */
  register(hash: string, location: IndexedChunkLocation): void {
    if (!this.map.has(hash)) {
      this.map.set(hash, location);
    }
  }

  /**
   * Looks up a chunk location by its SHA-256 hash.
   */
  find(hash: string): IndexedChunkLocation | undefined {
    return this.map.get(hash);
  }

  /**
   * Checks whether a chunk hash exists in the global index.
   */
  has(hash: string): boolean {
    return this.map.has(hash);
  }

  /**
   * Total number of unique chunks in the global index.
   */
  get size(): number {
    return this.map.size;
  }
}

/**
 * Builds a GlobalMerkleIndex by streaming and chunking all slices in an archive.
 */
export async function buildGlobalMerkleIndex(
  reader: IBinaryReader,
  slices: ArchiveEntrySlice[]
): Promise<GlobalMerkleIndex> {
  const index = new GlobalMerkleIndex();

  for (const slice of slices) {
    const uncompressedStream = inflateEntrySlice(reader, slice);
    for await (const chunk of chunkStream(uncompressedStream)) {
      index.register(chunk.hash, {
        sliceIndex: slice.index,
        offset: chunk.offset,
        length: chunk.length,
      });
    }
  }

  return index;
}
