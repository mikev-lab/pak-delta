# Comprehensive Testing Strategy and Chaos Engineering Framework

> Technical specification for the five-layer testing pyramid, procedural synthetic archive fixtures, adversarial edge case suites, and chaos failure resilience.

---

## 1. The Zero-Untested Code Formula

`pak-delta` operates under a non-negotiable engineering invariant:
- Every function, utility, algorithm branch, and error handler must have comprehensive, automated test coverage.
- 100% test coverage expectation across statements, branches, functions, and lines.
- Pull requests or commits containing untested logic, mock bypasses, or bypassed coverage gates are strictly prohibited.

---

## 2. Five-Layer Testing Pyramid

```text
+-------------------------------------------------------------------------+
| Layer 5: Automated Governance and Compliance Gate                       |
| (Zero em dashes, secret scanning, public spec integrity, no bloat)     |
+-------------------------------------------------------------------------+
| Layer 4: Chaos and Corruption Resilience Suites                         |
| (Truncated headers, single-bit flips, corrupted opcodes, bad baselines) |
+-------------------------------------------------------------------------+
| Layer 3: Adversarial Edge Case Suites                                   |
| (Streaming Data Descriptors, 4 KB DMA sector padding, low-entropy clamp)|
+-------------------------------------------------------------------------+
| Layer 2: Integration and End-to-End Reconstitution Tests                |
| (Dual-mode repack, sub-chunk deltas, global Merkle deduplication)       |
+-------------------------------------------------------------------------+
| Layer 1: Component-Level Unit Tests                                     |
| (Bitwise CRC32, FastCDC gear hash, LEB128 serialization, ZIP headers)   |
+-------------------------------------------------------------------------+
```

---

## 3. Procedural Synthetic Archive Generation

To eliminate repository bloat and comply with copyright laws:
- Real game packfiles or copyrighted third-party assets are strictly prohibited from Git.
- All test fixtures are generated procedurally in memory via `SyntheticArchiveGenerator` using deterministic PRNG seeds (`mulberry32`):

```typescript
// Deterministic 32-bit PRNG for reproducible test fixtures
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticArchiveOptions {
  entryCount: number;
  minEntrySize: number;
  maxEntrySize: number;
  seed: number;
  compressed: boolean;
  sectorAlignment?: number; // Optional 4096-byte Unreal DMA sector simulation
  useDataDescriptors?: boolean; // Optional FLAG_0x0008 streaming simulation
}

export interface SyntheticMutation {
  type: "insert_bytes" | "delete_bytes" | "modify_bytes" | "add_entry" | "rename_entry" | "duplicate_entry";
  entryIndex: number;
  offset: number;
  length: number;
  newPath?: string;
}
```

### Simulated Game Asset Types
The procedural generator simulates real-world game container assets:
1. **Uncompressed Audio / PCM:** Low-entropy repeating sinusoidal patterns.
2. **Game Textures / Normal Maps:** High-entropy semi-repeating 2D grid patterns.
3. **Compiled Bytecode / Scripts:** Medium-entropy token sequences with localized symbol table edits.
4. **Structured JSON / XML Configs:** Low-entropy structured text with key-value additions.

---

## 4. Adversarial Edge Case Test Matrix

The test suite includes dedicated automated test suites for all 13 empirical edge cases discovered in research:

| Edge Case Test | Test Identifier | Empirical Validation Target |
| :--- | :--- | :--- |
| **The Entropy Cascade** | `EXP-01` | Assert 1-byte edit scrambles $> 95\%$ downstream compressed bytes |
| **FastCDC Boundary Invariance** | `EXP-02` | Assert 17-byte insertion maintains $> 99\%$ deduplication (vs $< 10\%$ fixed) |
| **Native CompressionStream Parity** | `EXP-03` | Assert 100% deterministic bitstream match with Node/zlib Level 6 |
| **Encoder Divergence and Dual-Mode** | `EXP-04` | Assert Level 6 vs Level 9 bit divergence detected and routed to Bit-Preserving Mode |
| **Pareto Frontier Optimization** | `EXP-05` | Assert 4 KB to 8 KB nominal chunking yields lowest total net patch size |
| **Sub-Chunk Span Delta Compression** | `EXP-06` | Assert localized chunk edit reduces chunk payload by $> 99\%$ |
| **Global Merkle Deduplication** | `EXP-07` | Assert renamed and moved files achieve $> 99\%$ deduplication |
| **Gear Hash Line-Rate Throughput** | `EXP-08` | Assert pure TypeScript gear hash exceeds $500\text{ MB/sec}$ |
| **Pathological Input Clamping** | `EXP-09` | Assert repeating zeroes, ones, and alternating patterns clamp safely |
| **ZIP Streaming Data Descriptors** | `EXP-10` | Assert archives with `FLAG_0x0008` parse accurately via Central Directory |
| **Unreal DMA Sector Alignment** | `EXP-11` | Assert 4096-byte padding is isolated and reproduced byte-for-byte |
| **LEB128 Opcode Serialization** | `EXP-12` | Assert uLEB128 encoding delivers $> 75\%$ metadata reduction |
| **Bounded Streaming Memory** | `EXP-13` | Assert 50 MB+ workload retains heap delta $< 35\text{ MB}$ and peak $< 64\text{ MB}$ |

---

## 5. Chaos and Corruption Resilience Test Matrix

The chaos engineering suite simulates catastrophic real-world failure modes:

### 1. Truncated Header Injection
- Simulates an interrupted container download by truncating the file before the EOCD record.
- **Assertion:** Slicer throws `ERR_INVALID_ARCHIVE_HEADER` with actionable byte offset diagnostics.

### 2. Single-Bit Payload Corruption
- Injects a single-bit flip into a `COPY_CHUNK` or `INSERT_RAW` payload in the manifest.
- **Assertion:** Assembler throws `ERR_CHUNK_HASH_MISMATCH` before re-compression begins, aborting immediately.

### 3. Out-of-Bounds Span Delta Injection
- Injects an invalid span offset into a `PATCH_CHUNK` opcode that exceeds the chunk length.
- **Assertion:** Engine throws `ERR_SUBCHUNK_DELTA_CORRUPT`.

### 4. Mismatched Baseline Archive
- Attempts to apply a patch manifest against an incompatible or previously modified game archive.
- **Assertion:** Assembler throws `ERR_BASELINE_SHA256_MISMATCH` specifying expected vs received digests.

### 5. Corrupted DEFLATE Bitstream
- Injects corrupted Huffman table headers into a compressed slice.
- **Assertion:** Stream inflater throws `ERR_DEFLATE_CORRUPTION`.

---

## 6. Current Test Coverage Matrix

| Subsystem | Test Suites | Test Count | Scope |
| :--- | :--- | :--- | :--- |
| **Archive Slicing (`src/archive/`)** | `binaryReader`, `eocd`, `centralDirectory`, `localHeader`, `indexer`, `syntheticArchive`, `inflater` | 51 tests | Back-to-front EOCD scan, central directory records, DMA sector padding, data descriptors (`FLAG_0x0008`), streaming decompression |
| **FastCDC Chunker (`src/chunker/`)** | `table`, `fingerprint`, `fastcdc` | 12 tests | Deterministic gear table seed, SHA-256 Web Crypto / Node parity, boundary shift invariance, pathological clamping |
| **Diff and Manifest (`src/diff/`)** | `leb128`, `subChunkDelta`, `merkleIndex`, `matcher`, `manifest` | 27 tests | uLEB128 encoding/decoding, span delta compression, global deduplication, opcode emission, binary `PAKD` container round-trip and chaos |
| **Repack and Reconstitution (`src/repack/`)** | `crc32`, `compressor`, `writer`, `assembler`, `integration/repack` | 19 tests | IEEE 802.3 bitwise CRC32, native `CompressionStream` pipeline, deterministic container serializer, dual-mode client assembler, 100% byte-for-byte SHA-256 target parity, 4 KB DMA sector alignment, and atomic file swap |
| **Engine Facade (`src/engine.ts`)** | `engine` | 3 tests | Unified `createDelta`, `createDeltaManifest`, `applyDelta`, `applyDeltaToFile` across paths, buffers, and readers |
| **Chaos Engineering (`tests/chaos/`)** | `corruption`, `memory` | 7 tests | Truncated headers, single-bit flip payloads, corrupt magic, mismatched baselines, corrupted DEFLATE streams, streaming heap ceiling benchmark under 64 MB |
| **Governance Gate** | `compliance` | 7 tests | Stealth `.gitignore`, zero em dashes, 100% spec presence, secret scanner |
| **Public API** | `index` | 1 test | Package exports |
| **Empirical Validation** | `empirical_spike`, `advanced_empirical_studies`, `adversarial_edge_cases` | 13 tests | 13 scientific research experiments |
| **Total Verified Test Suite** | **28 Test Files** | **140 Tests** | **100% Passing** |
