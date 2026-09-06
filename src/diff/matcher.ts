/**
 * Delta Matcher and Recipe Generator.
 * Compares target container entries against the Global Container Merkle Index,
 * evaluates sub-chunk span deltas, detects repack modes, and emits optimal opcode sequences.
 */

import type { DeltaRecipeManifest, RecipeEntryDescriptor, RecipeOpcode } from "../types.js";
import type { ContainerIndex } from "../archive/indexer.js";
import type { IBinaryReader } from "../archive/binaryReader.js";
import { buildGlobalMerkleIndex } from "./merkleIndex.js";
import { computeSubChunkDelta } from "./subChunkDelta.js";
import { inflateEntrySlice, inflateEntrySliceToBuffer } from "../archive/inflater.js";
import { chunkStream } from "../chunker/fastcdc.js";
import { deflateRaw } from "../archive/streamUtils.js";
import { computeChunkHash } from "../chunker/fingerprint.js";

/**
 * Compares two Uint8Array buffers for exact bit-for-bit equality.
 */
function areBuffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Generates a complete DeltaRecipeManifest transforming source archive into target archive.
 */
export async function generateDeltaRecipe(
  sourceReader: IBinaryReader,
  sourceIndex: ContainerIndex,
  targetReader: IBinaryReader,
  targetIndex: ContainerIndex
): Promise<DeltaRecipeManifest> {
  // 1. Build Global Merkle Index across all source container slices
  const globalIndex = await buildGlobalMerkleIndex(sourceReader, sourceIndex.slices);

  const sourceSlicesByName = new Map(sourceIndex.slices.map((s) => [s.filename, s]));
  const payloadParts: Uint8Array[] = [];
  let totalPayloadLength = 0;

  const entries: RecipeEntryDescriptor[] = [];
  let targetTotalUncompressedBytes = 0;

  // 2. Process each target slice
  for (const targetSlice of targetIndex.slices) {
    targetTotalUncompressedBytes += targetSlice.uncompressedSize;

    // Evaluate Repack Mode: Standard (Level 6) vs Bit-Preserving
    let repackMode: "standard" | "bit_preserving" = "standard";

    if (targetSlice.compressionMethod === 8) {
      // Trial compression: deflate uncompressed slice and compare against target bitstream
      const targetUncompressed = await inflateEntrySliceToBuffer(targetReader, targetSlice);
      const trialCompressed = await deflateRaw(targetUncompressed);
      const actualCompressed = await targetReader.readAt(targetSlice.dataOffset, targetSlice.compressedSize);

      if (!areBuffersEqual(trialCompressed, actualCompressed)) {
        repackMode = "bit_preserving";
      }
    }

    const opcodes: RecipeOpcode[] = [];
    const sourceSlice = sourceSlicesByName.get(targetSlice.filename);

    if (repackMode === "bit_preserving") {
      const actualCompressed = await targetReader.readAt(targetSlice.dataOffset, targetSlice.compressedSize);
      const chunkHash = await computeChunkHash(actualCompressed);

      let copied = false;
      if (sourceSlice && sourceSlice.compressedSize === targetSlice.compressedSize) {
        const sourceCompressed = await sourceReader.readAt(sourceSlice.dataOffset, sourceSlice.compressedSize);
        if (areBuffersEqual(sourceCompressed, actualCompressed)) {
          opcodes.push({
            type: "COPY",
            sourceOffset: sourceSlice.dataOffset,
            length: targetSlice.compressedSize,
            chunkHash,
          });
          copied = true;
        }
      }

      if (!copied) {
        const payloadOffset = totalPayloadLength;
        payloadParts.push(actualCompressed);
        totalPayloadLength += actualCompressed.length;

        opcodes.push({
          type: "INSERT",
          payloadOffset,
          length: actualCompressed.length,
          chunkHash,
        });
      }

      entries.push({
        filename: targetSlice.filename,
        compressionMethod: targetSlice.compressionMethod,
        repackMode,
        uncompressedSize: targetSlice.uncompressedSize,
        compressedSize: targetSlice.compressedSize,
        crc32: targetSlice.crc32,
        alignmentPadding: targetSlice.alignmentPadding,
        opcodes,
      });
      continue;
    }

    let cachedSourceUncompressed: Uint8Array | null = null;

    // Stream target chunks with payload emission enabled
    const uncompressedStream = inflateEntrySlice(targetReader, targetSlice);

    for await (const chunk of chunkStream(uncompressedStream, { emitPayload: true })) {
      // Step A: Global Container Merkle Index Lookup
      const match = globalIndex.find(chunk.hash);
      if (match) {
        opcodes.push({
          type: "COPY",
          sourceOffset: match.offset,
          length: match.length,
          chunkHash: chunk.hash,
        });
        continue;
      }

      // Step B: Evaluate Secondary Sub-Chunk Span Delta
      let spanDeltaEmitted = false;
      if (sourceSlice && chunk.data) {
        if (!cachedSourceUncompressed) {
          cachedSourceUncompressed = await inflateEntrySliceToBuffer(sourceReader, sourceSlice);
        }

        if (chunk.offset < cachedSourceUncompressed.length) {
          const baselineEnd = Math.min(chunk.offset + chunk.length, cachedSourceUncompressed.length);
          const baselineChunk = cachedSourceUncompressed.subarray(chunk.offset, baselineEnd);
          const spanDelta = computeSubChunkDelta(baselineChunk, chunk.data);

          if (spanDelta !== null) {
            const deltaOffset = totalPayloadLength;
            const deltaLength = spanDelta.length;
            payloadParts.push(spanDelta);
            totalPayloadLength += deltaLength;

            opcodes.push({
              type: "PATCH",
              sourceOffset: chunk.offset,
              length: chunk.length,
              chunkHash: chunk.hash,
              deltaOffset,
              deltaLength,
            });
            spanDeltaEmitted = true;
          }
        }
      }

      // Step C: Novel Chunk Insertion
      if (!spanDeltaEmitted && chunk.data) {
        const payloadOffset = totalPayloadLength;
        payloadParts.push(chunk.data);
        totalPayloadLength += chunk.data.length;

        opcodes.push({
          type: "INSERT",
          payloadOffset,
          length: chunk.length,
          chunkHash: chunk.hash,
        });
      }
    }

    entries.push({
      filename: targetSlice.filename,
      compressionMethod: targetSlice.compressionMethod,
      repackMode,
      uncompressedSize: targetSlice.uncompressedSize,
      compressedSize: targetSlice.compressedSize,
      crc32: targetSlice.crc32,
      alignmentPadding: targetSlice.alignmentPadding,
      opcodes,
    });
  }

  // 3. Assemble unified raw payload pool
  const rawPayloadPool = new Uint8Array(totalPayloadLength);
  let poolWriteOffset = 0;
  for (const part of payloadParts) {
    rawPayloadPool.set(part, poolWriteOffset);
    poolWriteOffset += part.length;
  }

  return {
    magic: "PAKD",
    version: "1.0.0",
    sourceArchiveSha256: sourceIndex.archiveSha256,
    targetArchiveSha256: targetIndex.archiveSha256,
    targetTotalUncompressedBytes,
    entries,
    rawPayloadSize: totalPayloadLength,
    rawPayloadPool,
  };
}
