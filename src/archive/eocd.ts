/**
 * End of Central Directory (EOCD) locator and parser.
 * Reads archive containers back-to-front with bounded memory consumption.
 */

import type { IBinaryReader } from "./binaryReader.js";
import { InvalidArchiveHeaderError } from "./errors.js";

export const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06
export const MIN_EOCD_SIZE = 22;
export const MAX_COMMENT_SIZE = 65535;
export const MAX_EOCD_SEARCH_WINDOW = MIN_EOCD_SIZE + MAX_COMMENT_SIZE;

export interface EOCDRecord {
  diskNumber: number;
  cdStartDisk: number;
  diskEntries: number;
  totalEntries: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
  commentLength: number;
  comment: Uint8Array;
  eocdOffset: number;
}

/**
 * Searches backwards from the end of the archive to locate and parse the EOCD record.
 */
export async function findAndParseEOCD(reader: IBinaryReader): Promise<EOCDRecord> {
  if (reader.size < MIN_EOCD_SIZE) {
    throw new InvalidArchiveHeaderError(
      `Archive is smaller than minimum EOCD record size (22 bytes). Size: ${reader.size}`
    );
  }

  const searchWindowSize = Math.min(reader.size, MAX_EOCD_SEARCH_WINDOW);
  const searchWindowOffset = reader.size - searchWindowSize;
  const searchBuffer = await reader.readAt(searchWindowOffset, searchWindowSize);
  const view = new DataView(searchBuffer.buffer, searchBuffer.byteOffset, searchBuffer.byteLength);

  // Scan backwards from the latest possible EOCD position
  let matchPos = -1;
  for (let pos = searchBuffer.length - MIN_EOCD_SIZE; pos >= 0; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) {
      const commentLength = view.getUint16(pos + 20, true);
      // Validate that the recorded comment length precisely matches remaining buffer length
      if (pos + MIN_EOCD_SIZE + commentLength === searchBuffer.length) {
        matchPos = pos;
        break;
      }
    }
  }

  if (matchPos === -1) {
    throw new InvalidArchiveHeaderError(
      "End of Central Directory (EOCD) signature not found within trailing search window"
    );
  }

  const diskNumber = view.getUint16(matchPos + 4, true);
  const cdStartDisk = view.getUint16(matchPos + 6, true);
  const diskEntries = view.getUint16(matchPos + 8, true);
  const totalEntries = view.getUint16(matchPos + 10, true);
  const centralDirectorySize = view.getUint32(matchPos + 12, true);
  const centralDirectoryOffset = view.getUint32(matchPos + 16, true);
  const commentLength = view.getUint16(matchPos + 20, true);
  const comment = searchBuffer.subarray(matchPos + 22, matchPos + 22 + commentLength);
  const eocdOffset = searchWindowOffset + matchPos;

  // Basic sanity validation
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new InvalidArchiveHeaderError(
      `Central Directory boundary [${centralDirectoryOffset}, ${centralDirectoryOffset + centralDirectorySize}) exceeds EOCD offset ${eocdOffset}`
    );
  }

  return {
    diskNumber,
    cdStartDisk,
    diskEntries,
    totalEntries,
    centralDirectorySize,
    centralDirectoryOffset,
    commentLength,
    comment,
    eocdOffset,
  };
}
