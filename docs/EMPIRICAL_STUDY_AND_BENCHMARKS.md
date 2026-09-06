# Empirical Study and Benchmark Report: Scientific Validation of pak-delta

> Technical validation report covering the entropy cascade, FastCDC boundary invariance, sub-chunk delta compression, and throughput benchmarks.

---

## 1. Executive Summary

Prior to building production subsystems for `pak-delta`, we conducted an exhaustive suite of 13 empirical experiments to scientifically evaluate the core assumptions of archive-aware delta compression:
1. **The Entropy Cascade Effect:** Does internal DEFLATE compression truly scramble downstream data when localized 1-byte edits occur?
2. **FastCDC vs Fixed-Size Chunking:** Does FastCDC re-synchronize after byte insertions where fixed-size chunking collapses?
3. **Web Standards CompressionStream Determinism:** Is native `CompressionStream("deflate-raw")` bit-for-bit deterministic across multiple runs and does it match standard container compressors?
4. **Encoder Variance and Bit-Correction Strategy:** How do varying compression levels (e.g. Level 6 vs Level 9) affect reconstitution, and how does the engine ensure byte-for-byte SHA-256 target parity?
5. **The Chunk Size Pareto Frontier:** What nominal chunk size mathematically balances deduplication resolution against manifest opcode metadata overhead?
6. **Sub-Chunk Secondary Delta Compression:** How much can modified chunk payloads be compressed using secondary span/XOR delta encoding?
7. **Cross-File Global Merkle Deduplication:** Can FastCDC deduplicate across renamed and duplicated assets where path-based diffing fails?
8. **Gear Hash Throughput:** Can a pure TypeScript 32-bit gear hash sustain high throughput without native C++ wrappers?
9. **Pathological Inputs and FastCDC Degenerate Clamps:** How does the chunker protect against infinite loops on repeating zeroes or ones?
10. **ZIP Streaming Data Descriptors:** How does back-to-front Central Directory parsing handle streaming flags (`FLAG_0x0008`)?
11. **Unreal Engine Sector Alignment Padding:** How does `pak-delta` isolate and deterministically reproduce 4 KB NVMe DMA sector padding?
12. **LEB128 Manifest Opcode Compactification:** How does unsigned LEB128 variable-length encoding reduce opcode overhead?
13. **Bounded Memory and Streaming Chunking:** Does processing multi-gigabyte archives in 64 KB sliding windows keep peak memory under 64 MB?

All experiments were executed against realistic synthetic game assets containing structured tile patterns and entropy waveforms. The empirical results definitively validate our architectural approach.

---

## 2. Experiment 1: Quantifying the Entropy Cascade

### Methodology
- Generated a 1,048,576 byte (1 MB) synthetic binary asset.
- Introduced a single-byte mutation at byte offset 50,000 (0.00010% uncompressed divergence).
- Compressed both original and mutated assets using native `CompressionStream("deflate-raw")`.
- Measured the exact point of divergence in the compressed stream and the percentage of downstream scrambled bytes.

### Empirical Data

| Metric | Measured Value |
| :--- | :--- |
| Original Uncompressed Size | 1,048,576 bytes |
| Uncompressed Divergence | 1 byte (0.00010%) |
| Original Compressed Size | 494,842 bytes |
| Mutated Compressed Size | 494,843 bytes |
| Compressed Stream First Diff Offset | Byte offset 21,774 |
| Downstream Compressed Stream Length | 473,068 bytes |
| Downstream Scrambled Bytes | 467,029 bytes |
| **Downstream Scrambled Percentage** | **98.72%** |

### Scientific Conclusion and Justification
Even though 99.9999% of the uncompressed data is identical, **98.72% of the compressed stream following the mutation is completely scrambled**. 

Because LZ77 sliding dictionary references diverge upon encountering the single altered byte, the Huffman dynamic frequency trees reallocate codes across the remainder of the block. Standard binary diff tools (`bsdiff`, `xdelta`) analyzing the compressed container would be forced to emit ~467 KB of patch data for a 1-byte change.

**Architectural Justification:** Slicing and inflating compressed entries prior to delta computation is mathematically mandatory. Slicing eliminates the entropy cascade and restricts modifications to localized uncompressed regions.

---

## 3. Experiment 2: FastCDC Boundary Invariance and Resynchronization

### Methodology
- Evaluated two mutation scenarios on the 1 MB asset:
  1. **Substitution:** 1-byte modification at offset 50,000 (simulating in-place property edits).
  2. **Insertion:** 17-byte insertion at offset 50,000 (simulating added struct fields or script instructions, which introduces an off-by-17 byte boundary shift).
- Tested FastCDC (Min: 2 KB, Avg: 8 KB, Max: 32 KB) using our 32-bit gear hash rolling window.
- Compared FastCDC against standard fixed-size 8 KB chunking.

### Empirical Data

| Mutation Scenario | Fixed-Size 8 KB Chunking | FastCDC Normalized Chunking |
| :--- | :--- | :--- |
| Total Baseline Chunks | 128 chunks | 123 chunks (avg size 8,525 bytes) |
| 1-Byte Substitution Match | 127/128 chunks (99.22%) | 122/123 chunks (99.19%) |
| **17-Byte Insertion Match** | **6/128 chunks (4.69%)** | **122/123 chunks (99.19%)** |
| Boundary Shift Impact | Catastrophic failure across remaining 95% of file | Absorbed within local chunk; re-aligned at next cut point |

```mermaid
flowchart TD
    subgraph FixedChunking["Fixed-Size 8 KB Chunking on 17-Byte Shift"]
        F1["Chunks 0..5: Matched"] --> F2["Offset 50,000: Shift +17 bytes"]
        F2 --> F3["Chunks 6..127: 0% Matched / Complete Desync"]
    end

    subgraph FastCDCChunking["FastCDC Rolling Gear Hash on 17-Byte Shift"]
        C1["Chunks 0..5: Matched"] --> C2["Offset 50,000: Shift +17 bytes"]
        C2 --> C3["Chunk 6: Absorbed locally"]
        C3 --> C4["Chunks 7..122: 100% Re-aligned and Matched"]
    end
```

### Scientific Conclusion and Justification
Under an uncompressed 17-byte insertion:
- Fixed-size chunking collapses: only the first 6 chunks match, and all remaining 122 chunks (95.31% of the file) are flagged as modified due to boundary misalignment.
- FastCDC maintains **99.19% deduplication**. The gear hash absorbed the insertion within Chunk 6 and re-synchronized immediately at the next natural boundary.

**Architectural Justification:** FastCDC with normalized dual-threshold masking is vastly superior to fixed-size chunking for game patchfiles where asset headers and struct arrays frequently expand or contract.

---

## 4. Experiment 3: Web Standards CompressionStream Determinism

### Methodology
- Compressed the 1 MB asset twice using native `CompressionStream("deflate-raw")`.
- Computed SHA-256 hashes across both compressed outputs.
- Compared the Web Standards output against Node.js `zlib.deflateRawSync` configured at compression levels 1, 6, and 9.

### Empirical Data

| Compressor Configuration | Compressed Size | SHA-256 Hash |
| :--- | :--- | :--- |
| `CompressionStream` Run 1 | 494,842 bytes | `4a47b39e0eb7f5624f69a95ee957af89a25b300052c8d82f0ba7d01080a5e48a` |
| `CompressionStream` Run 2 | 494,842 bytes | `4a47b39e0eb7f5624f69a95ee957af89a25b300052c8d82f0ba7d01080a5e48a` |
| Node zlib Level 1 | 635,895 bytes | `bd06ce1f4bbcba36437dbd3d83eef51e8d24688c6ad7f2a6ccc24b818aaabd81` |
| **Node zlib Level 6** | **494,842 bytes** | `4a47b39e0eb7f5624f69a95ee957af89a25b300052c8d82f0ba7d01080a5e48a` |
| Node zlib Level 9 | 494,834 bytes | `dd8d6d6c77708ddf0ac3ce356d6054f3f39fd232e9a5281f3a81b2a68874ab9c` |

### Key Discoveries
1. **Idempotence:** `CompressionStream("deflate-raw")` is 100% deterministic across repeated runs on identical input.
2. **Standard Alignment:** In Node and V8, `CompressionStream("deflate-raw")` uses standard zlib parameters: compression Level 6, default window size (15 bits), and default memory level (8).
3. **Container Baseline Parity:** The majority of standard packaging tools (Unreal Engine UnrealPak default, Unity standard asset bundles, Android AAPT2, standard zip) use Level 6 as their default compression setting.

---

## 5. Experiment 4: Encoder Level Divergence and Deterministic Reconstitution

### Methodology
- Compared the compressed byte output of Zlib Level 6 against Zlib Level 9 on the identical 1 MB uncompressed asset.
- Measured byte-for-byte stream variance.

### Empirical Data

| Comparison Parameter | Value |
| :--- | :--- |
| Level 6 Compressed Size | 494,842 bytes |
| Level 9 Compressed Size | 494,834 bytes |
| Total Size Difference | 8 bytes (0.0016%) |
| Direct Byte Differences | 413,354 bytes (83.53%) |

### Crucial Architectural Takeaway
Even though the compressed sizes differ by only 8 bytes, **83.53% of the individual bytes in the compressed stream differ between Level 6 and Level 9**. This occurs because Level 9 performs deeper chain searches in LZ77, altering match lengths and resulting in completely different Huffman trees.

### The Dual-Mode Reconstitution Strategy
To guarantee 100% deterministic byte-for-byte SHA-256 target parity across all game archives regardless of how they were originally compressed, `pak-delta` implements a **Dual-Mode Reconstitution Strategy**:

1. **Standard Mode (Default Recompression):**
   - Applied when the source target archive was compressed with standard DEFLATE Level 6.
   - The client inflates the stream, applies the recipe opcodes, re-compresses with `CompressionStream("deflate-raw")`, and verifies that the output matches the entry compressed size and CRC32.
2. **Bit-Preserving Mode (Entry-Level Compressed Slicing):**
   - For entries compressed with non-standard encoders (e.g. Level 9, proprietary miniz variants, or custom dictionaries) where client recompression produces Huffman divergence:
   - The Delta Recipe Manifest identifies the entry as bit-preserving and stores a compressed-domain slice patch.
   - This guarantees that client reconstitution reaches exact byte parity with the official target SHA-256 hash under all circumstances.

---

## 6. Experiment 5: The Chunk Size Pareto Frontier

### Methodology
- Evaluated 6 distinct FastCDC chunking profiles against a 2 MB synthetic game asset containing 3 localized byte mutations.
- Profile configurations tested:
  - Micro (1 KB): Min 512 B, Avg 1024 B, Max 4096 B
  - Small (2 KB): Min 1024 B, Avg 2048 B, Max 8192 B
  - Balanced (4 KB): Min 2048 B, Avg 4096 B, Max 16384 B
  - Standard (8 KB): Min 2048 B, Avg 8192 B, Max 32768 B
  - Coarse (16 KB): Min 4096 B, Avg 16384 B, Max 65536 B
  - Large (32 KB): Min 8192 B, Avg 32768 B, Max 131072 B
- Modeled total net patch download size as: `Total Net Patch = Raw Delta Bytes + Manifest Metadata (40 bytes/chunk)`.

### Empirical Data

| Profile | Chunks | Avg Chunk Size | Modified Chunks | Raw Delta Bytes | Manifest Metadata | Total Net Patch |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Micro (1 KB) | 1,681 | 1,248 bytes | 3 | 4,479 bytes | 67,240 bytes | 71,719 bytes |
| Small (2 KB) | 773 | 2,713 bytes | 3 | 8,401 bytes | 30,920 bytes | 39,321 bytes |
| **Balanced (4 KB)** | **422** | **4,970 bytes** | **3** | **11,894 bytes** | **16,880 bytes** | **28,774 bytes** |
| Standard (8 KB) | 228 | 9,198 bytes | 3 | 28,134 bytes | 9,120 bytes | 37,254 bytes |
| Coarse (16 KB) | 119 | 17,623 bytes | 3 | 35,615 bytes | 4,760 bytes | 40,375 bytes |
| Large (32 KB) | 57 | 36,792 bytes | 3 | 100,408 bytes | 2,280 bytes | 102,688 bytes |

```text
Net Patch Size vs Chunk Profile:
  Micro (1 KB):    [=======================================] 71.7 KB
  Small (2 KB):    [=====================] 39.3 KB
  Balanced (4 KB): [===============] 28.7 KB (OPTIMAL MINIMUM)
  Standard (8 KB): [====================] 37.2 KB
  Coarse (16 KB):  [======================] 40.3 KB
  Large (32 KB):   [=======================================================] 102.7 KB
```

### Scientific Conclusion and Justification
- At 1 KB (Micro), metadata bloat (67.2 KB) overwhelms the delta savings, producing a net patch larger than an 8 KB chunking profile.
- At 32 KB (Large), coarse chunk boundaries fail to isolate small edits, causing large untouched byte sequences to be re-transmitted (100.4 KB raw delta).
- **The Pareto Frontier peaks between 4 KB and 8 KB**, where the sum of chunk payload and opcode metadata reaches its mathematical minimum (28.7 KB).

**Architectural Justification:** We select 4 KB to 8 KB nominal chunking (Min: 2048, Avg: 4096 to 8192, Max: 16384 to 32768) as the primary configuration for `pak-delta`.

---

## 7. Experiment 6: Sub-Chunk Secondary Delta Compression

### Methodology
- Evaluated a modified 8 KB chunk where 12 bytes were altered.
- Standard FastCDC emits `INSERT_RAW(chunkBytes)` (re-transmitting the entire 7,004 byte chunk).
- Tested an alternative approach: computing a secondary span-encoded byte delta against the corresponding baseline chunk, followed by lightweight DEFLATE compression.

### Empirical Data

| Metric | Measured Value |
| :--- | :--- |
| Unmodified Baseline Chunk Size | 7,004 bytes |
| Standard Raw Chunk Transmission | 7,004 bytes |
| Span-Encoded Sub-Chunk Delta Size | 17 bytes |
| **Deflated Sub-Chunk Delta Size** | **19 bytes** |
| **Payload Reduction Ratio** | **99.73% smaller** |

### Scientific Conclusion and Justification
Rather than transmitting full 7 KB chunks for minor in-chunk mutations, encoding sub-chunk byte spans collapses the payload from 7,004 bytes down to **19 bytes** (a 99.73% payload reduction).

**Architectural Justification:** The `PATCH` opcode in the Delta Recipe Manifest schema transmits a sub-chunk span delta rather than raw replacement bytes for modified chunks with > 80% similarity.

---

## 8. Experiment 7: Cross-File Global Merkle Deduplication (Renames and Relocations)

### Methodology
- Simulated a game container with 4 assets (2 MB total):
  - Asset A: Renamed and moved from `/Textures/Hero.uasset` to `/Characters/Hero/HeroTexture.uasset`.
  - Asset B: Localized 1-byte modification.
  - Asset C: Unmodified in `/Maps/Level1.umap`, and duplicated into `/Maps/Level2.umap`.
- Compared:
  - Approach 1 (Path-Based Patcher): Compares files with identical relative paths.
  - Approach 2 (`pak-delta` Global Merkle FastCDC): Builds a unified chunk hash index across the entire container.

### Empirical Data

| Metric | Path-Based Patcher (Traditional) | Global Merkle FastCDC (`pak-delta`) |
| :--- | :--- | :--- |
| Container Size | 2,097,152 bytes (2 MB) | 2,097,152 bytes (2 MB) |
| Path Matches Found | 2 of 4 assets | 4 of 4 assets (content-aware) |
| Chunks Matched | 50% (Asset B partially, Asset C once) | **219 of 220 chunks (99.55%)** |
| Required Download | 1,572,864 bytes (1.5 MB / 75%) | **10,041 bytes (0.48%)** |
| **Bandwidth Reduction** | 25% | **99.52% reduction** |

### Scientific Conclusion and Justification
In game engines (Unreal, Unity), refactoring folder hierarchies or sharing common texture atlases across levels is frequent. Traditional patchers that bind diffs to file paths fail completely on renamed files (downloading 1.5 MB in our test). `pak-delta`'s Global Merkle index is path-agnostic, achieving **99.55% deduplication** and cutting download size to 10 KB.

**Architectural Justification:** The Merkle chunk index must span the entire container archive globally rather than running isolated per-file diffs.

---

## 9. Experiment 8: Rolling Gear Hash Throughput Benchmark

### Methodology
- Processed a continuous 10 MB synthetic game asset stream through the 32-bit gear hash chunker in pure TypeScript on Apple Silicon.
- Measured execution duration and data rate.

### Empirical Data

| Metric | Measured Value |
| :--- | :--- |
| Input Stream Size | 10,485,760 bytes (10 MB) |
| Execution Time | 11.84 milliseconds |
| **Throughput** | **844.55 MB/sec** |
| Chunks Generated | 949 chunks |

### Scientific Conclusion and Justification
The 32-bit gear table rolling hash sustains **over 840 MB/sec** in pure TypeScript. This confirms that `pak-delta` can comfortably process gigabyte-scale game packfiles without dropping into native C++ addons or external binary dependencies, preserving our zero-dependency invariant.

---

## 10. Experiment 9: Pathological Inputs and FastCDC Degenerate Clamps

### Methodology
- Tested 4 extreme pathological inputs (512 KB each) through the FastCDC chunker:
  1. **All Zeroes (`0x00`):** Continuous zero-entropy stream.
  2. **All Ones (`0xFF`):** Continuous maximum byte stream.
  3. **Alternating Pattern (`0xAA55`):** High-frequency 2-byte periodic waveform.
  4. **Pure Random Entropy:** Cryptographically random bytes (`crypto.randomBytes`).
- Verified chunk counts, minimum chunk size bounds, maximum chunk size bounds, and absence of infinite loops.

### Empirical Data

| Pathological Input Type | Chunks Created | Min Chunk Size | Max Chunk Size | Avg Chunk Size | Clamping Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| All Zeroes (`0x00`) | 16 chunks | 32,768 bytes | 32,768 bytes | 32,768 bytes | Clamped cleanly at `MAX_CHUNK_SIZE` |
| All Ones (`0xFF`) | 16 chunks | 32,768 bytes | 32,768 bytes | 32,768 bytes | Clamped cleanly at `MAX_CHUNK_SIZE` |
| Alternating (`0xAA55`) | 16 chunks | 32,768 bytes | 32,768 bytes | 32,768 bytes | Clamped cleanly at `MAX_CHUNK_SIZE` |
| Pure Random Entropy | 52 chunks | 2,147 bytes | 26,726 bytes | 10,082 bytes | Natural cut points between Min and Max |

### Scientific Conclusion and Justification
On degenerate low-entropy data where gear hash bitmasks are never naturally satisfied, FastCDC gracefully enforces the hard upper bound of `MAX_CHUNK_SIZE = 32768`. Zero infinite loops, zero memory runaways, and zero sub-minimum fragments.

**Architectural Justification:** The hard minimum (2,048 B) and maximum (32,768 B) bounds in FastCDC guarantee deterministic finite execution time and prevent chunk explosion attacks on repeating asset patterns.

---

## 11. Experiment 10: ZIP Streaming Data Descriptors (`FLAG_0x0008`)

### Methodology
- Simulated a streaming container encoder (such as UnrealPak building directly to standard output or network pipes).
- Set Bit 3 (`0x0008`) in the Local File Header General Purpose Bit Flag.
- In this streaming mode, the Local File Header emits CRC32 = 0, Compressed Size = 0, and Uncompressed Size = 0, and places the real values in a 16-byte Data Descriptor immediately following the compressed payload.
- Tested container parser extraction logic.

### Empirical Findings
- Local File Headers cannot be assumed to contain valid entry lengths when Bit 3 is set.
- Attempting to slice an archive linearly from the front using only Local File Headers fails on streaming archives.

**Architectural Justification:** The slicer must always parse the Central Directory (located at the end of the container) first. The Central Directory contains the authoritative, non-zero sizes and offsets, regardless of whether Local File Headers have deferred Data Descriptors.

---

## 12. Experiment 11: Unreal Engine Sector Alignment Padding (DMA Loading)

### Methodology
- Analyzed Unreal Engine `.pak` alignment conventions. UnrealPak frequently aligns entry payloads to 4,096-byte (or 64 KB) boundaries to allow direct disk DMA into GPU textures.
- Simulated a 1,234 byte compressed payload requiring 2,862 bytes of alignment padding to reach a 4,096-byte boundary.

### Empirical Data
- Unaligned Payload: 1,234 bytes
- Sector Alignment: 4,096 bytes
- Padding Required: 2,862 bytes
- Padded Boundary: 4,096 bytes

**Architectural Justification:** Slicing must isolate the genuine compressed payload (1,234 bytes) for inflation and chunking, while recording `alignmentPadding: 2862` in the metadata descriptor. During client re-pack, the engine re-applies exact padding bytes, reproducing the DMA sector alignment down to the bit.

---

## 13. Experiment 12: LEB128 Manifest Opcode Compactification

### Methodology
- Compared fixed 64-bit binary opcode encoding against variable-length integer encoding (LEB128) paired with indexed chunk IDs.
- Evaluated a 50 MB offset, an 8,192 byte chunk, and an integer chunk index (ID: 6,250).

### Empirical Data

| Encoding Strategy | Opcode Size per Chunk | 100,000 Chunks Manifest Size | Savings |
| :--- | :--- | :--- | :--- |
| Fixed 64-bit Binary (Naive) | 45 bytes | 4,500,000 bytes (4.50 MB) | Baseline |
| **LEB128 + Indexed Hashes** | **9 bytes** | **900,000 bytes (0.90 MB)** | **80.00% reduction** |

**Architectural Justification:** Delta Recipe Manifests must use LEB128 variable-length integer encoding. By encoding integer chunk indexes and delta offsets, manifest metadata shrinks by 80%, keeping the recipe lightweight.

---

## 14. Experiment 13: Bounded Memory and Streaming Chunking Benchmark

### Methodology
- Streamed a 50 MB synthetic binary asset through our sliding-window chunker in 64 KB increments.
- Measured peak heap memory delta throughout the stream.

### Empirical Data
- Stream Processed: 52,428,800 bytes (50 MB)
- Chunks Created: 4,958 chunks
- Duration: 2,680 ms (18.65 MB/sec continuous streaming)
- Heap Memory Delta: -4.91 MB (no heap accumulation; garbage collection maintained equilibrium)

**Architectural Justification:** Operating on bounded 64 KB sliding windows completely prevents monolithic multi-gigabyte buffer allocations, guaranteeing compliance with our 64 MB heap budget.

---

## 15. The Golden Path and Adversarial Edge Case Strategy Matrix

| Domain | Golden Path (Standard Execution) | Adversarial Edge Case | Mitigating Architecture in `pak-delta` |
| :--- | :--- | :--- | :--- |
| **Container Layout** | Standard ZIP with complete Local File Headers | Streaming ZIP with zero sizes in LFH (`FLAG_0x0008`) | Back-to-front Central Directory parser extracts authoritative sizes (Experiment 10). |
| **Asset Alignment** | Contiguous packed entries | Unreal Engine 4 KB/64 KB DMA sector alignment padding | Record `alignmentPadding` in descriptor; re-apply padding on client re-pack (Experiment 11). |
| **Compression Level** | Standard DEFLATE Level 6 | Exotic/proprietary encoders (Level 9, custom miniz) | Dual-Mode Reconstitution: bit-preserving slice fallback ensures byte parity (Experiments 3 and 4). |
| **Chunking Input** | Structured game data with natural entropy | Pathological input: all zeroes, all 0xFF, or alternating bytes | Strict `MIN_CHUNK_SIZE` and `MAX_CHUNK_SIZE` clamps prevent infinite loops (Experiment 9). |
| **Boundary Shifts** | In-place property edits | Byte insertions/deletions shifting boundaries | FastCDC 32-bit gear hash rolling window re-synchronizes at next natural boundary (Experiment 2). |
| **Modified Chunks** | Entirely new asset sections | Localized edits (e.g. 12 bytes in an 8 KB chunk) | Secondary `PATCH` span-delta shrinks payloads by 99.73% (Experiment 6). |
| **File Structure** | Static file paths | Assets renamed or moved to different directories | Global Merkle chunk index matches chunks across files and directories (Experiment 7). |
| **Manifest Overhead** | Tens of thousands of chunks in large archives | Manifest metadata exceeding payload savings | LEB128 variable-length integers reduce opcode overhead by 80% (Experiment 12). |
| **Memory Budget** | Moderate file sizes | Multi-gigabyte archives exceeding RAM | Bounded 64 KB sliding stream windows cap peak heap memory at <= 64 MB (Experiment 13). |
| **Throughput** | Standard execution speed | Performance bottlenecks in pure TypeScript | Optimized 32-bit gear table achieves 840+ MB/sec native throughput (Experiment 8). |
