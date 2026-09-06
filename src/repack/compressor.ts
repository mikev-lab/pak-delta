/**
 * Deterministic DEFLATE Compression Pipeline using native CompressionStream.
 * Compresses data in bounded streaming windows matching standard zlib Level 6 defaults.
 */

/**
 * Compresses an uncompressed byte buffer using native CompressionStream("deflate-raw").
 */
export async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = cs.readable.getReader();
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

/**
 * Pipes an AsyncIterable stream of uncompressed chunks into CompressionStream("deflate-raw"),
 * yielding compressed byte chunks in bounded memory.
 */
export async function* compressDeflateRawStream(
  stream: AsyncIterable<Uint8Array>
): AsyncIterable<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  let writeError: unknown = null;
  const writingPromise = (async () => {
    try {
      for await (const chunk of stream) {
        await writer.write(chunk);
      }
      await writer.close();
    } catch (err) {
      writeError = err;
      try {
        await writer.abort(err);
      } catch {
        // Ignore secondary abort error
      }
    }
  })();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
    await writingPromise;
    if (writeError) throw writeError;
  } finally {
    reader.releaseLock();
  }
}
