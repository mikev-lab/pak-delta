/**
 * Streaming utilities for bounded-memory chunk processing.
 */

import type { IBinaryReader } from "./binaryReader.js";

export const DEFAULT_STREAM_CHUNK_SIZE = 65536; // 64 KB streaming window

/**
 * Creates a ReadableStream that reads a slice of an archive in bounded chunk windows.
 */
export function createSliceReadableStream(
  reader: IBinaryReader,
  offset: number,
  length: number,
  chunkSize: number = DEFAULT_STREAM_CHUNK_SIZE
): ReadableStream<Uint8Array> {
  let currentOffset = offset;
  const endOffset = offset + length;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (currentOffset >= endOffset) {
        controller.close();
        return;
      }
      const bytesToRead = Math.min(chunkSize, endOffset - currentOffset);
      try {
        const chunk = await reader.readAt(currentOffset, bytesToRead);
        currentOffset += chunk.length;
        controller.enqueue(chunk);
        if (currentOffset >= endOffset) {
          controller.close();
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Adapts a standard Web ReadableStream into an AsyncIterable.
 */
export async function* readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Collects an AsyncIterable of Uint8Array chunks into a single buffer, with an optional size limit guard.
 */
export async function collectChunks(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes?: number
): Promise<Uint8Array> {
  const bufferList: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of chunks) {
    totalLength += chunk.length;
    if (maxBytes !== undefined && totalLength > maxBytes) {
      throw new RangeError(
        `Stream output exceeded maximum allowed buffer limit of ${maxBytes} bytes (reached ${totalLength} bytes)`
      );
    }
    bufferList.push(chunk);
  }

  const result = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const buf of bufferList) {
    result.set(buf, writeOffset);
    writeOffset += buf.length;
  }
  return result;
}

/**
 * Compresses data using native Web Standards CompressionStream("deflate-raw").
 */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  return collectChunks(readableStreamToAsyncIterable(cs.readable));
}
