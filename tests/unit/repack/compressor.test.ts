import { describe, it, expect } from "vitest";
import { compressDeflateRaw, compressDeflateRawStream } from "../../../src/repack/compressor.js";

async function decompressDeflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe("Deterministic DEFLATE Compressor", () => {
  it("compresses deterministically with 100% bit-for-bit repeatability", async () => {
    const data = new Uint8Array(32768);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 17) & 0xFF;
    }

    const run1 = await compressDeflateRaw(data);
    const run2 = await compressDeflateRaw(data);

    expect(run1.length).toBe(run2.length);
    expect(Array.from(run1)).toEqual(Array.from(run2));
  });

  it("produces data that decompresses back to exact original bytes", async () => {
    const text = "pak-delta: high-performance archive-aware content-defined delta compression";
    const data = new TextEncoder().encode(text.repeat(100));

    const compressed = await compressDeflateRaw(data);
    expect(compressed.length).toBeLessThan(data.length);

    const decompressed = await decompressDeflateRaw(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(text.repeat(100));
  });

  it("compresses streaming chunks via compressDeflateRawStream with identical result", async () => {
    const data = new Uint8Array(16384);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 31) & 0xFF;
    }

    async function* makeChunkStream() {
      for (let offset = 0; offset < data.length; offset += 4096) {
        yield data.subarray(offset, offset + 4096);
      }
    }

    const streamChunks: Uint8Array[] = [];
    for await (const chunk of compressDeflateRawStream(makeChunkStream())) {
      streamChunks.push(chunk);
    }

    let streamTotalLen = 0;
    for (const c of streamChunks) streamTotalLen += c.length;
    const streamResult = new Uint8Array(streamTotalLen);
    let off = 0;
    for (const c of streamChunks) {
      streamResult.set(c, off);
      off += c.length;
    }

    const oneShotResult = await compressDeflateRaw(data);
    expect(Array.from(streamResult)).toEqual(Array.from(oneShotResult));
  });
});
