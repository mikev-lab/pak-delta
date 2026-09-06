/**
 * Domain errors for delta matching, sub-chunk delta compression, and manifest serialization.
 */

export class CorruptedSubChunkDeltaError extends Error {
  readonly code = "ERR_SUBCHUNK_DELTA_CORRUPT";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(`Corrupted sub-chunk delta: ${message}`);
    this.name = "CorruptedSubChunkDeltaError";
    Object.setPrototypeOf(this, CorruptedSubChunkDeltaError.prototype);
  }
}

export class InvalidManifestError extends Error {
  readonly code = "ERR_INVALID_MANIFEST";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(`Invalid delta recipe manifest: ${message}`);
    this.name = "InvalidManifestError";
    Object.setPrototypeOf(this, InvalidManifestError.prototype);
  }
}
