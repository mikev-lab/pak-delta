/**
 * Client Reconstitution Engine.
 * Reconstitutes target archives byte-for-byte from baseline archive slices
 * and the binary PAKD Delta Recipe Manifest.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { DeltaRecipeManifest, ArchiveEntrySlice } from "../types.js";
import type { IBinaryReader } from "../archive/binaryReader.js";
import { indexArchive } from "../archive/indexer.js";
import { inflateEntrySliceToBuffer } from "../archive/inflater.js";
import { buildGlobalMerkleIndex, type GlobalMerkleIndex } from "../diff/merkleIndex.js";
import { applySubChunkDelta } from "../diff/subChunkDelta.js";
import { computeChunkHashSync } from "../chunker/fingerprint.js";
import { computeCrc32 } from "./crc32.js";
import { compressDeflateRaw } from "./compressor.js";
import { serializeArchive, type ContainerEntryToWrite } from "./writer.js";
import {
  BaselineSha256MismatchError,
  ChunkHashMismatchError,
  TargetSha256MismatchError,
  CorruptedOpcodePayloadError,
  Crc32MismatchError,
} from "./errors.js";

/**
 * Computes the SHA-256 hash of a reader in streaming 64 KB chunks to respect the memory budget.
 */
async function computeReaderSha256(reader: IBinaryReader): Promise<string> {
  const hash = createHash("sha256");
  const chunkSize = 65536;
  let offset = 0;

  while (offset < reader.size) {
    const toRead = Math.min(chunkSize, reader.size - offset);
    const chunk = await reader.readAt(offset, toRead);
    hash.update(chunk);
    offset += toRead;
  }

  return hash.digest("hex");
}

/**
 * Concatenates an array of Uint8Arrays into a single Uint8Array.
 */
function flattenUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) {
    totalLength += arr.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Validates that a chunk's SHA-256 matches the expected digest.
 */
function verifyChunkHash(chunk: Uint8Array, expectedHash: string, opcodeType: string): void {
  const actualHash = computeChunkHashSync(chunk);
  if (actualHash !== expectedHash) {
    throw new ChunkHashMismatchError(expectedHash, actualHash, opcodeType);
  }
}

/**
 * Bounded LRU cache of uncompressed baseline entry slices to minimize decompression overhead
 * while keeping heap allocation strictly below the 64 MB ceiling.
 */
class BaselineSliceCache {
  private cache = new Map<number, Uint8Array>();
  private readonly maxCached = 4;

  constructor(
    private reader: IBinaryReader,
    private slices: ArchiveEntrySlice[]
  ) {}

  async getSlice(sliceIndex: number): Promise<Uint8Array> {
    const cached = this.cache.get(sliceIndex);
    if (cached) return cached;

    const slice = this.slices.find((s) => s.index === sliceIndex);
    if (!slice) {
      throw new CorruptedOpcodePayloadError(
        `Referenced baseline slice index ${sliceIndex} not found in baseline archive.`
      );
    }

    const uncompressed = await inflateEntrySliceToBuffer(this.reader, slice);

    if (this.cache.size >= this.maxCached) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(sliceIndex, uncompressed);
    return uncompressed;
  }
}

/**
 * Reconstitutes the target archive in memory from a baseline archive reader and Delta Recipe Manifest.
 */
export async function reconstituteArchive(
  sourceReader: IBinaryReader,
  manifest: DeltaRecipeManifest
): Promise<Uint8Array> {
  // 1. Validate Baseline Archive SHA-256
  const actualBaselineSha256 = await computeReaderSha256(sourceReader);
  if (actualBaselineSha256 !== manifest.sourceArchiveSha256) {
    throw new BaselineSha256MismatchError(manifest.sourceArchiveSha256, actualBaselineSha256);
  }

  // 2. Index Baseline Archive and build Global Merkle Index
  const baselineIndex = await indexArchive(sourceReader);
  const baselineGlobalIndex: GlobalMerkleIndex = await buildGlobalMerkleIndex(
    sourceReader,
    baselineIndex.slices
  );
  const baselineSlicesByName = new Map(baselineIndex.slices.map((s) => [s.filename, s]));
  const sliceCache = new BaselineSliceCache(sourceReader, baselineIndex.slices);

  const entriesToWrite: ContainerEntryToWrite[] = [];
  const payloadPool = manifest.rawPayloadPool ?? new Uint8Array(0);

  // 3. Process each entry in the recipe manifest
  for (const entry of manifest.entries) {
    let entryPayload: Uint8Array;

    if (entry.repackMode === "bit_preserving") {
      // Bit-Preserving Mode: Directly restore exact compressed slice bytes
      const parts: Uint8Array[] = [];

      for (const op of entry.opcodes) {
        if (op.type === "COPY") {
          const chunk = await sourceReader.readAt(op.sourceOffset, op.length);
          verifyChunkHash(chunk, op.chunkHash, "COPY (bit-preserving)");
          parts.push(chunk);
        } else if (op.type === "INSERT") {
          if (op.payloadOffset + op.length > payloadPool.length) {
            throw new CorruptedOpcodePayloadError(
              `INSERT opcode payload range [${op.payloadOffset}, ${op.payloadOffset + op.length}] ` +
              `exceeds raw payload pool length (${payloadPool.length}).`
            );
          }
          const chunk = payloadPool.subarray(op.payloadOffset, op.payloadOffset + op.length);
          verifyChunkHash(chunk, op.chunkHash, "INSERT (bit-preserving)");
          parts.push(chunk);
        } else {
          throw new CorruptedOpcodePayloadError(
            `Unsupported opcode "${(op as { type: string }).type}" in bit-preserving entry ${entry.filename}`
          );
        }
      }

      entryPayload = flattenUint8Arrays(parts);
    } else {
      // Standard Mode: Reconstitute uncompressed chunks and compress with CompressionStream
      const uncompressedParts: Uint8Array[] = [];
      const sourceSlice = baselineSlicesByName.get(entry.filename);

      for (const op of entry.opcodes) {
        if (op.type === "COPY") {
          let chunk: Uint8Array | null = null;
          const match = baselineGlobalIndex.find(op.chunkHash);

          if (match) {
            const sliceData = await sliceCache.getSlice(match.sliceIndex);
            chunk = sliceData.subarray(match.offset, match.offset + match.length);
          } else if (sourceSlice) {
            const sliceData = await sliceCache.getSlice(sourceSlice.index);
            chunk = sliceData.subarray(op.sourceOffset, op.sourceOffset + op.length);
          }

          if (!chunk) {
            throw new ChunkHashMismatchError(op.chunkHash, "NOT_FOUND_IN_BASELINE", "COPY");
          }

          verifyChunkHash(chunk, op.chunkHash, "COPY");
          uncompressedParts.push(chunk);
        } else if (op.type === "PATCH") {
          if (!sourceSlice) {
            throw new CorruptedOpcodePayloadError(
              `PATCH opcode references file "${entry.filename}" which does not exist in baseline archive.`
            );
          }

          const sliceData = await sliceCache.getSlice(sourceSlice.index);
          if (op.sourceOffset + op.length > sliceData.length) {
            throw new CorruptedOpcodePayloadError(
              `PATCH opcode source range [${op.sourceOffset}, ${op.sourceOffset + op.length}] ` +
              `exceeds baseline slice size (${sliceData.length}).`
            );
          }
          const baselineChunk = sliceData.subarray(op.sourceOffset, op.sourceOffset + op.length);

          if (op.deltaOffset + op.deltaLength > payloadPool.length) {
            throw new CorruptedOpcodePayloadError(
              `PATCH opcode delta range [${op.deltaOffset}, ${op.deltaOffset + op.deltaLength}] ` +
              `exceeds raw payload pool length (${payloadPool.length}).`
            );
          }
          const deltaBytes = payloadPool.subarray(op.deltaOffset, op.deltaOffset + op.deltaLength);

          const patchedChunk = applySubChunkDelta(baselineChunk, deltaBytes);
          verifyChunkHash(patchedChunk, op.chunkHash, "PATCH");
          uncompressedParts.push(patchedChunk);
        } else if (op.type === "INSERT") {
          if (op.payloadOffset + op.length > payloadPool.length) {
            throw new CorruptedOpcodePayloadError(
              `INSERT opcode payload range [${op.payloadOffset}, ${op.payloadOffset + op.length}] ` +
              `exceeds raw payload pool length (${payloadPool.length}).`
            );
          }
          const chunk = payloadPool.subarray(op.payloadOffset, op.payloadOffset + op.length);
          verifyChunkHash(chunk, op.chunkHash, "INSERT");
          uncompressedParts.push(chunk);
        }
      }

      const uncompressedData = flattenUint8Arrays(uncompressedParts);

      // Verify uncompressed CRC32
      const actualCrc = computeCrc32(uncompressedData);
      if (actualCrc !== entry.crc32) {
        throw new Crc32MismatchError(
          `entry "${entry.filename}" expected 0x${entry.crc32.toString(16).padStart(8, "0")}, got 0x${actualCrc.toString(16).padStart(8, "0")}`
        );
      }

      if (entry.compressionMethod === 8) {
        entryPayload = await compressDeflateRaw(uncompressedData);
      } else {
        entryPayload = uncompressedData;
      }
    }

    entriesToWrite.push({
      name: entry.filename,
      compressionMethod: entry.compressionMethod,
      crc32: entry.crc32,
      uncompressedSize: entry.uncompressedSize,
      compressedSize: entryPayload.length,
      data: entryPayload,
      alignmentPadding: entry.alignmentPadding,
    });
  }

  // 4. Serialize container binary
  const serialized = serializeArchive(entriesToWrite);

  // 5. Verify Target Archive SHA-256 Bit-Parity
  const finalSha256 = createHash("sha256").update(serialized.bytes).digest("hex");
  if (finalSha256 !== manifest.targetArchiveSha256) {
    throw new TargetSha256MismatchError(manifest.targetArchiveSha256, finalSha256);
  }

  return serialized.bytes;
}

/**
 * Reconstitutes the target archive to a file on disk using an atomic staging file swap.
 */
export async function reconstituteArchiveToFile(
  sourceReader: IBinaryReader,
  manifest: DeltaRecipeManifest,
  targetPath: string
): Promise<void> {
  const tmpPath = `${targetPath}.pak.tmp`;

  try {
    const bytes = await reconstituteArchive(sourceReader, manifest);
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore if tmpPath does not exist
    }
    throw err;
  }
}
