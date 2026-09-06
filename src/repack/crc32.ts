/**
 * High-performance bitwise IEEE 802.3 CRC32 engine.
 * Precomputes 256-word lookup table for line-rate checksumming with zero dependencies.
 */

const CRC_TABLE = new Uint32Array(256);

// Precompute IEEE 802.3 polynomial table
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Computes the IEEE 802.3 CRC32 of a byte buffer.
 * Optional seed allows chaining checksums across streaming fragments.
 */
export function computeCrc32(data: Uint8Array, seed: number = 0): number {
  let crc = (seed ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Running IEEE 802.3 CRC32 streaming accumulator.
 * Allows computing CRC32 over arbitrary chunked streams without buffering everything in memory.
 */
export class Crc32Stream {
  private crc: number = 0xFFFFFFFF;

  /**
   * Feeds a data chunk into the running CRC32 computation.
   */
  update(chunk: Uint8Array): this {
    let c = this.crc;
    for (let i = 0; i < chunk.length; i++) {
      c = (CRC_TABLE[(c ^ chunk[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
    }
    this.crc = c;
    return this;
  }

  /**
   * Finalizes and returns the 32-bit unsigned CRC32 digest.
   */
  digest(): number {
    return (this.crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Resets the accumulator back to initial state.
   */
  reset(): void {
    this.crc = 0xFFFFFFFF;
  }
}
