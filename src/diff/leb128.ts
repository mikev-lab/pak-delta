/**
 * Unsigned Little-Endian Base 128 (uLEB128) variable-length integer serialization.
 * Compacts integer offsets, lengths, and chunk dictionary pointers by up to 80%.
 */

/**
 * Encodes an unsigned integer into a variable-length uLEB128 byte sequence.
 */
export function encodeULEB128(value: number): Uint8Array {
  if (value < 0 || !Number.isFinite(value)) {
    throw new RangeError(`encodeULEB128 requires a non-negative finite integer, received ${value}`);
  }

  const bytes: number[] = [];
  let val = Math.floor(value);

  do {
    let byte = val & 0x7F;
    val = Math.floor(val / 128);
    if (val !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (val !== 0);

  return new Uint8Array(bytes);
}

/**
 * Decodes an unsigned integer from a buffer starting at offset using uLEB128.
 */
export function decodeULEB128(buffer: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (offset < 0 || offset >= buffer.length) {
    throw new RangeError(`decodeULEB128 offset ${offset} is out of bounds (buffer size: ${buffer.length})`);
  }

  let result = 0;
  let multiplier = 1;
  let bytesRead = 0;

  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;

    result += (byte & 0x7F) * multiplier;
    multiplier *= 128;

    if ((byte & 0x80) === 0) {
      return { value: result, bytesRead };
    }
  }

  throw new RangeError(`decodeULEB128 reached end of buffer without finding terminal byte at offset ${offset}`);
}
