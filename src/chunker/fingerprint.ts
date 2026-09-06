/**
 * Chunk fingerprinting utility using native Web Crypto and Node crypto APIs.
 */

import { createHash } from "node:crypto";

/**
 * Computes the 64-character lowercase hex SHA-256 fingerprint of a chunk using Web Crypto.
 */
export async function computeChunkHash(chunk: Uint8Array): Promise<string> {
  const digestBuffer = await crypto.subtle.digest("SHA-256", chunk as unknown as ArrayBuffer);
  const bytes = new Uint8Array(digestBuffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Computes the 64-character lowercase hex SHA-256 fingerprint of a chunk synchronously.
 */
export function computeChunkHashSync(chunk: Uint8Array): string {
  return createHash("sha256").update(chunk).digest("hex");
}
