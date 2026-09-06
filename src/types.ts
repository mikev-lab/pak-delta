/**
 * Master domain interfaces and types for pak-delta.
 */

export interface ArchiveEntrySlice {
  index: number;
  filename: string;
  compressionMethod: number; // 0 = STORED, 8 = DEFLATE
  localHeaderOffset: number;
  dataOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  extraFieldLength: number;
}

export interface ChunkFingerprint {
  hash: string;
  sourceSliceIndex: number;
  uncompressedOffset: number;
  length: number;
}

export type RecipeOpcode =
  | { type: "COPY"; sourceOffset: number; length: number; chunkHash: string }
  | { type: "INSERT"; payloadOffset: number; length: number; chunkHash: string };

export interface RecipeEntryDescriptor {
  filename: string;
  compressionMethod: number;
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
  extraFieldBase64?: string;
  comment?: string;
  opcodes: RecipeOpcode[];
}

export interface DeltaRecipeManifest {
  version: "1.0.0";
  sourceArchiveSha256: string;
  targetArchiveSha256: string;
  targetTotalUncompressedBytes: number;
  entries: RecipeEntryDescriptor[];
  rawPayloadSize: number;
}
