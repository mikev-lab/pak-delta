/**
 * Domain errors for archive parsing, container slicing and inflation.
 */

export class InvalidArchiveHeaderError extends Error {
  readonly code = "ERR_INVALID_ARCHIVE_HEADER";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(`Invalid archive header: ${message}`);
    this.name = "InvalidArchiveHeaderError";
    Object.setPrototypeOf(this, InvalidArchiveHeaderError.prototype);
  }
}

export class TruncatedArchiveError extends Error {
  readonly code = "ERR_TRUNCATED_ARCHIVE";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(`Truncated archive: ${message}`);
    this.name = "TruncatedArchiveError";
    Object.setPrototypeOf(this, TruncatedArchiveError.prototype);
  }
}

export class DeflateCorruptionError extends Error {
  readonly code = "ERR_DEFLATE_CORRUPTION";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(`DEFLATE stream corrupted: ${message}`);
    this.name = "DeflateCorruptionError";
    Object.setPrototypeOf(this, DeflateCorruptionError.prototype);
  }
}

export class Crc32MismatchError extends Error {
  readonly code = "ERR_CRC32_MISMATCH";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(`CRC32 checksum mismatch: ${message}`);
    this.name = "Crc32MismatchError";
    Object.setPrototypeOf(this, Crc32MismatchError.prototype);
  }
}

export class UnsupportedCompressionMethodError extends Error {
  readonly code = "ERR_UNSUPPORTED_COMPRESSION_METHOD";

  constructor(method: number, readonly details?: Record<string, unknown>) {
    super(`Unsupported compression method: ${method} (only Method 0 STORED and Method 8 DEFLATED supported)`);
    this.name = "UnsupportedCompressionMethodError";
    Object.setPrototypeOf(this, UnsupportedCompressionMethodError.prototype);
  }
}
