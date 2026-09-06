/**
 * Local File Header (LFH) parser and payload offset calculator.
 */

import type { IBinaryReader } from "./binaryReader.js";
import { InvalidArchiveHeaderError, TruncatedArchiveError } from "./errors.js";

export const LFH_SIGNATURE = 0x04034b50; // PK\x03\x04
export const LFH_FIXED_SIZE = 30;

export interface LocalFileHeaderInfo {
  localHeaderOffset: number;
  versionNeeded: number;
  bitFlag: number;
  compressionMethod: number;
  lastModTime: number;
  lastModDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  filenameLength: number;
  extraFieldLength: number;
  filename: string;
  extraField: Uint8Array;
  dataOffset: number;
  totalHeaderLength: number;
}

/**
 * Reads and parses the Local File Header at localHeaderOffset, determining the exact payload dataOffset.
 */
export async function readLocalFileHeader(
  reader: IBinaryReader,
  localHeaderOffset: number
): Promise<LocalFileHeaderInfo> {
  if (localHeaderOffset < 0 || localHeaderOffset + LFH_FIXED_SIZE > reader.size) {
    throw new TruncatedArchiveError(
      `Cannot read Local File Header: offset ${localHeaderOffset} exceeds archive size ${reader.size}`
    );
  }

  const fixedBuffer = await reader.readAt(localHeaderOffset, LFH_FIXED_SIZE);
  const view = new DataView(fixedBuffer.buffer, fixedBuffer.byteOffset, fixedBuffer.byteLength);

  const signature = view.getUint32(0, true);
  if (signature !== LFH_SIGNATURE) {
    throw new InvalidArchiveHeaderError(
      `Expected Local File Header signature 0x04034b50 at offset ${localHeaderOffset}, found 0x${signature.toString(16)}`
    );
  }

  const versionNeeded = view.getUint16(4, true);
  const bitFlag = view.getUint16(6, true);
  const compressionMethod = view.getUint16(8, true);
  const lastModTime = view.getUint16(10, true);
  const lastModDate = view.getUint16(12, true);
  const crc32 = view.getUint32(14, true);
  const compressedSize = view.getUint32(18, true);
  const uncompressedSize = view.getUint32(22, true);
  const filenameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);

  const variableLength = filenameLength + extraFieldLength;
  const totalHeaderLength = LFH_FIXED_SIZE + variableLength;
  const dataOffset = localHeaderOffset + totalHeaderLength;

  if (localHeaderOffset + totalHeaderLength > reader.size) {
    throw new TruncatedArchiveError(
      `Local File Header at offset ${localHeaderOffset} extends beyond archive boundary`
    );
  }

  let filename = "";
  let extraField: Uint8Array = new Uint8Array(0);

  if (variableLength > 0) {
    const varBuffer = await reader.readAt(localHeaderOffset + LFH_FIXED_SIZE, variableLength);
    if (filenameLength > 0) {
      filename = new TextDecoder().decode(varBuffer.subarray(0, filenameLength));
    }
    if (extraFieldLength > 0) {
      extraField = varBuffer.subarray(filenameLength, variableLength);
    }
  }

  return {
    localHeaderOffset,
    versionNeeded,
    bitFlag,
    compressionMethod,
    lastModTime,
    lastModDate,
    crc32,
    compressedSize,
    uncompressedSize,
    filenameLength,
    extraFieldLength,
    filename,
    extraField,
    dataOffset,
    totalHeaderLength,
  };
}
