/**
 * Binary PAKD Delta Recipe Manifest Serializer and Deserializer.
 * Serializes delta recipe metadata, uLEB128 opcode streams, and raw payload pools.
 */

import type { DeltaRecipeManifest, RecipeEntryDescriptor, RecipeOpcode } from "../types.js";
import { encodeULEB128, decodeULEB128 } from "./leb128.js";
import { InvalidManifestError } from "./errors.js";

export const PAKD_MAGIC = 0x444B4150; // 'PAKD' Little-Endian (0x50, 0x41, 0x4B, 0x44)
export const PAKD_VERSION = 1;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new InvalidManifestError(`Expected 64-character hex string, got ${hex.length}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Serializes a DeltaRecipeManifest into a compact binary PAKD container buffer.
 */
export function serializeManifest(manifest: DeltaRecipeManifest): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1. Container Header (Magic, Version, Flags)
  const header = new Uint8Array(6);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, PAKD_MAGIC, true);
  headerView.setUint8(4, PAKD_VERSION);
  headerView.setUint8(5, 0); // Flags
  parts.push(header);

  // 2. Cryptographic Archive Hashes
  parts.push(hexToBytes(manifest.sourceArchiveSha256));
  parts.push(hexToBytes(manifest.targetArchiveSha256));

  // 3. Target Uncompressed Size
  parts.push(encodeULEB128(manifest.targetTotalUncompressedBytes));

  // 4. Entry Metadata Table
  parts.push(encodeULEB128(manifest.entries.length));

  const textEncoder = new TextEncoder();

  for (const entry of manifest.entries) {
    const pathBytes = textEncoder.encode(entry.filename);
    parts.push(encodeULEB128(pathBytes.length));
    parts.push(pathBytes);

    const flags = new Uint8Array(2);
    flags[0] = entry.compressionMethod;
    flags[1] = entry.repackMode === "bit_preserving" ? 1 : 0;
    parts.push(flags);

    parts.push(encodeULEB128(entry.uncompressedSize));
    parts.push(encodeULEB128(entry.compressedSize));

    const crcBuf = new Uint8Array(4);
    new DataView(crcBuf.buffer).setUint32(0, entry.crc32, true);
    parts.push(crcBuf);

    parts.push(encodeULEB128(entry.alignmentPadding ?? 0));

    // Opcode Stream for this entry
    parts.push(encodeULEB128(entry.opcodes.length));

    for (const op of entry.opcodes) {
      const opHeader = new Uint8Array(1);
      const hashBytes = hexToBytes(op.chunkHash);

      if (op.type === "COPY") {
        opHeader[0] = 0; // COPY
        parts.push(opHeader, hashBytes);
        parts.push(encodeULEB128(op.sourceOffset));
        parts.push(encodeULEB128(op.length));
      } else if (op.type === "PATCH") {
        opHeader[0] = 1; // PATCH
        parts.push(opHeader, hashBytes);
        parts.push(encodeULEB128(op.sourceOffset));
        parts.push(encodeULEB128(op.length));
        parts.push(encodeULEB128(op.deltaOffset));
        parts.push(encodeULEB128(op.deltaLength));
      } else if (op.type === "INSERT") {
        opHeader[0] = 2; // INSERT
        parts.push(opHeader, hashBytes);
        parts.push(encodeULEB128(op.payloadOffset));
        parts.push(encodeULEB128(op.length));
      }
    }
  }

  // 5. Raw Payload Pool
  const payloadPool = manifest.rawPayloadPool ?? new Uint8Array(0);
  parts.push(encodeULEB128(payloadPool.length));
  if (payloadPool.length > 0) {
    parts.push(payloadPool);
  }

  // Flatten parts into single Uint8Array
  let totalLength = 0;
  for (const part of parts) {
    totalLength += part.length;
  }

  const result = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const part of parts) {
    result.set(part, writeOffset);
    writeOffset += part.length;
  }

  return result;
}

/**
 * Deserializes a binary PAKD container buffer back into a DeltaRecipeManifest.
 */
export function deserializeManifest(buffer: Uint8Array): DeltaRecipeManifest {
  if (buffer.length < 70) {
    throw new InvalidManifestError(
      `Manifest buffer is smaller than minimum PAKD header size (70 bytes). Size: ${buffer.length}`
    );
  }

  let readOffset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 1. Verify Magic and Version
  const magic = view.getUint32(0, true);
  if (magic !== PAKD_MAGIC) {
    throw new InvalidManifestError(
      `Invalid manifest magic: expected 0x${PAKD_MAGIC.toString(16)}, found 0x${magic.toString(16)}`
    );
  }

  const version = view.getUint8(4);
  if (version !== PAKD_VERSION) {
    throw new InvalidManifestError(`Unsupported manifest version: ${version}`);
  }

  readOffset = 6;

  // 2. Cryptographic Hashes
  const sourceArchiveSha256 = bytesToHex(buffer.subarray(readOffset, readOffset + 32));
  readOffset += 32;

  const targetArchiveSha256 = bytesToHex(buffer.subarray(readOffset, readOffset + 32));
  readOffset += 32;

  // 3. Target Uncompressed Size
  const targetUncompressedRes = decodeULEB128(buffer, readOffset);
  const targetTotalUncompressedBytes = targetUncompressedRes.value;
  readOffset += targetUncompressedRes.bytesRead;

  // 4. Entry Metadata Table
  const entryCountRes = decodeULEB128(buffer, readOffset);
  const entryCount = entryCountRes.value;
  readOffset += entryCountRes.bytesRead;

  const textDecoder = new TextDecoder();
  const entries: RecipeEntryDescriptor[] = [];

  for (let e = 0; e < entryCount; e++) {
    const pathLenRes = decodeULEB128(buffer, readOffset);
    readOffset += pathLenRes.bytesRead;

    const filename = textDecoder.decode(buffer.subarray(readOffset, readOffset + pathLenRes.value));
    readOffset += pathLenRes.value;

    const compressionMethod = buffer[readOffset++];
    const repackModeFlag = buffer[readOffset++];
    const repackMode: "standard" | "bit_preserving" = repackModeFlag === 1 ? "bit_preserving" : "standard";

    const uncompressedSizeRes = decodeULEB128(buffer, readOffset);
    readOffset += uncompressedSizeRes.bytesRead;

    const compressedSizeRes = decodeULEB128(buffer, readOffset);
    readOffset += compressedSizeRes.bytesRead;

    const crc32 = view.getUint32(readOffset, true);
    readOffset += 4;

    const alignmentPaddingRes = decodeULEB128(buffer, readOffset);
    readOffset += alignmentPaddingRes.bytesRead;

    // Opcodes
    const opcodeCountRes = decodeULEB128(buffer, readOffset);
    readOffset += opcodeCountRes.bytesRead;

    const opcodes: RecipeOpcode[] = [];

    for (let o = 0; o < opcodeCountRes.value; o++) {
      const typeTag = buffer[readOffset++];
      const chunkHash = bytesToHex(buffer.subarray(readOffset, readOffset + 32));
      readOffset += 32;

      if (typeTag === 0) {
        // COPY
        const srcOffRes = decodeULEB128(buffer, readOffset);
        readOffset += srcOffRes.bytesRead;
        const lenRes = decodeULEB128(buffer, readOffset);
        readOffset += lenRes.bytesRead;

        opcodes.push({
          type: "COPY",
          sourceOffset: srcOffRes.value,
          length: lenRes.value,
          chunkHash,
        });
      } else if (typeTag === 1) {
        // PATCH
        const srcOffRes = decodeULEB128(buffer, readOffset);
        readOffset += srcOffRes.bytesRead;
        const lenRes = decodeULEB128(buffer, readOffset);
        readOffset += lenRes.bytesRead;
        const deltaOffRes = decodeULEB128(buffer, readOffset);
        readOffset += deltaOffRes.bytesRead;
        const deltaLenRes = decodeULEB128(buffer, readOffset);
        readOffset += deltaLenRes.bytesRead;

        opcodes.push({
          type: "PATCH",
          sourceOffset: srcOffRes.value,
          length: lenRes.value,
          chunkHash,
          deltaOffset: deltaOffRes.value,
          deltaLength: deltaLenRes.value,
        });
      } else if (typeTag === 2) {
        // INSERT
        const payloadOffRes = decodeULEB128(buffer, readOffset);
        readOffset += payloadOffRes.bytesRead;
        const lenRes = decodeULEB128(buffer, readOffset);
        readOffset += lenRes.bytesRead;

        opcodes.push({
          type: "INSERT",
          payloadOffset: payloadOffRes.value,
          length: lenRes.value,
          chunkHash,
        });
      } else {
        throw new InvalidManifestError(`Unknown opcode type tag: ${typeTag}`);
      }
    }

    entries.push({
      filename,
      compressionMethod,
      repackMode,
      uncompressedSize: uncompressedSizeRes.value,
      compressedSize: compressedSizeRes.value,
      crc32,
      alignmentPadding: alignmentPaddingRes.value,
      opcodes,
    });
  }

  // 5. Raw Payload Pool
  const payloadPoolLenRes = decodeULEB128(buffer, readOffset);
  readOffset += payloadPoolLenRes.bytesRead;

  const rawPayloadPool = buffer.subarray(readOffset, readOffset + payloadPoolLenRes.value);

  return {
    magic: "PAKD",
    version: "1.0.0",
    sourceArchiveSha256,
    targetArchiveSha256,
    targetTotalUncompressedBytes,
    entries,
    rawPayloadSize: rawPayloadPool.length,
    rawPayloadPool,
  };
}
