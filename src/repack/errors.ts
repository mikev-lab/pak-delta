/**
 * Repack and Reconstitution Structured Errors.
 */

export class BaselineSha256MismatchError extends Error {
  readonly code = "ERR_BASELINE_SHA256_MISMATCH";

  constructor(expected: string, actual: string) {
    super(
      `Baseline archive SHA-256 mismatch. Expected: ${expected}, Actual: ${actual}. ` +
      `The local source archive does not match the patch baseline.`
    );
    this.name = "BaselineSha256MismatchError";
  }
}

export class ChunkHashMismatchError extends Error {
  readonly code = "ERR_CHUNK_HASH_MISMATCH";

  constructor(expected: string, actual: string, opcodeType: string) {
    super(
      `Chunk SHA-256 checksum mismatch during ${opcodeType} opcode resolution. ` +
      `Expected: ${expected}, Actual: ${actual}.`
    );
    this.name = "ChunkHashMismatchError";
  }
}

export class TargetSha256MismatchError extends Error {
  readonly code = "ERR_TARGET_SHA256_MISMATCH";

  constructor(expected: string, actual: string) {
    super(
      `Target archive SHA-256 parity assertion failed. Expected: ${expected}, Actual: ${actual}. ` +
      `The reconstituted archive does not match the target container bit-for-bit.`
    );
    this.name = "TargetSha256MismatchError";
  }
}

export class CorruptedOpcodePayloadError extends Error {
  readonly code = "ERR_CORRUPTED_OPCODE_PAYLOAD";

  constructor(message: string) {
    super(message);
    this.name = "CorruptedOpcodePayloadError";
  }
}

export { Crc32MismatchError } from "../archive/errors.js";
