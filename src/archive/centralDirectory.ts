/**
 * Central Directory header parser for ZIP and game packfile containers.
 */

import type { IBinaryReader } from "./binaryReader.js";
import { InvalidArchiveHeaderError, TruncatedArchiveError } from "./errors.js";

export const CDFH_SIGNATURE = 0x02014b50; // PK\x01\x02
export const CDFH_FIXED_SIZE = 46;

export interface CentralDirectoryEntry {
  index: number;
  versionMadeBy: number;
  versionNeeded: number;
  bitFlag: number;
  compressionMethod: number; // 0 = Stored, 8 = Deflated
  lastModTime: number;
  lastModDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  filenameLength: number;
  extraFieldLength: number;
  commentLength: number;
  diskNumberStart: number;
  internalAttributes: number;
  externalAttributes: number;
  localHeaderOffset: number;
  filename: string;
  extraField: Uint8Array;
  comment: Uint8Array;
  hasDataDescriptor: boolean;
}

/**
 * Parses all Central Directory records from an archive container.
 */
export async function parseCentralDirectory(
  reader: IBinaryReader,
  cdOffset: number,
  cdSize: number,
  totalEntries: number
): Promise<CentralDirectoryEntry[]> {
  if (cdSize === 0 && totalEntries === 0) {
    return [];
  }

  const cdBuffer = await reader.readAt(cdOffset, cdSize);
  const view = new DataView(cdBuffer.buffer, cdBuffer.byteOffset, cdBuffer.byteLength);
  const textDecoder = new TextDecoder();
  const entries: CentralDirectoryEntry[] = [];

  let offset = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + CDFH_FIXED_SIZE > cdBuffer.length) {
      throw new TruncatedArchiveError(
        `Central Directory buffer ended prematurely while reading entry ${i} of ${totalEntries}`
      );
    }

    const signature = view.getUint32(offset, true);
    if (signature !== CDFH_SIGNATURE) {
      throw new InvalidArchiveHeaderError(
        `Expected Central Directory signature 0x02014b50 at byte ${cdOffset + offset}, found 0x${signature.toString(16)}`
      );
    }

    const versionMadeBy = view.getUint16(offset + 4, true);
    const versionNeeded = view.getUint16(offset + 6, true);
    const bitFlag = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const lastModTime = view.getUint16(offset + 12, true);
    const lastModDate = view.getUint16(offset + 14, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskNumberStart = view.getUint16(offset + 34, true);
    const internalAttributes = view.getUint16(offset + 36, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const recordTotalLength = CDFH_FIXED_SIZE + filenameLength + extraFieldLength + commentLength;
    if (offset + recordTotalLength > cdBuffer.length) {
      throw new TruncatedArchiveError(
        `Variable length fields for entry ${i} exceed Central Directory boundary`
      );
    }

    const filenameBytes = cdBuffer.subarray(offset + 46, offset + 46 + filenameLength);
    const filename = textDecoder.decode(filenameBytes);

    const extraField = cdBuffer.subarray(
      offset + 46 + filenameLength,
      offset + 46 + filenameLength + extraFieldLength
    );

    const comment = cdBuffer.subarray(
      offset + 46 + filenameLength + extraFieldLength,
      offset + recordTotalLength
    );

    const hasDataDescriptor = (bitFlag & 0x0008) !== 0;

    entries.push({
      index: i,
      versionMadeBy,
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
      commentLength,
      diskNumberStart,
      internalAttributes,
      externalAttributes,
      localHeaderOffset,
      filename,
      extraField,
      comment,
      hasDataDescriptor,
    });

    offset += recordTotalLength;
  }

  return entries;
}
