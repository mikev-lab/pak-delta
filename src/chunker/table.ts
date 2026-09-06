/**
 * Deterministic 256-element 32-bit gear hash lookup table for FastCDC.
 * Precomputed using a deterministic pseudo-random sequence with seed 0x50414B44 ('PAKD').
 */

function generateGearTable(): Uint32Array {
  const table = new Uint32Array(256);
  let state = 0x50414B44; // 'PAKD' in ASCII
  for (let i = 0; i < 256; i++) {
    // 32-bit linear congruential generator (Knuth)
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    table[i] = state;
  }
  return table;
}

export const GEAR_TABLE: Uint32Array = generateGearTable();
