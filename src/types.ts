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
  alignmentPadding?: number;
  hasDataDescriptor?: boolean;
}

export interface ChunkFingerprint {
  hash: string;
  sourceSliceIndex: number;
  uncompressedOffset: number;
  length: number;
}

export type RecipeOpcode =
  | { type: "COPY"; sourceOffset: number; length: number; chunkHash: string }
  | { type: "PATCH"; sourceOffset: number; length: number; chunkHash: string; deltaOffset: number; deltaLength: number }
  | { type: "INSERT"; payloadOffset: number; length: number; chunkHash: string };

export interface RecipeEntryDescriptor {
  filename: string;
  compressionMethod: number; // 0 = Stored, 8 = Deflated
  repackMode: "standard" | "bit_preserving";
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
  alignmentPadding?: number;
  extraFieldBase64?: string;
  comment?: string;
  opcodes: RecipeOpcode[];
}

export interface DeltaRecipeManifest {
  magic: "PAKD";
  version: "1.0.0";
  sourceArchiveSha256: string;
  targetArchiveSha256: string;
  targetTotalUncompressedBytes: number;
  entries: RecipeEntryDescriptor[];
  rawPayloadSize: number;
  rawPayloadPool?: Uint8Array;
}
