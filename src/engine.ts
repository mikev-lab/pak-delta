/**
 * High-Level Engine Facade for pak-delta.
 * Exposes developer-friendly, unified entry points for creating and applying delta patches.
 */

import { open } from "node:fs/promises";
import type { DeltaRecipeManifest } from "./types.js";
import {
  type IBinaryReader,
  MemoryBinaryReader,
  FileHandleBinaryReader,
} from "./archive/binaryReader.js";
import { indexArchive } from "./archive/indexer.js";
import { generateDeltaRecipe } from "./diff/matcher.js";
import { serializeManifest, deserializeManifest } from "./diff/manifest.js";
import { reconstituteArchive, reconstituteArchiveToFile } from "./repack/assembler.js";

interface ManagedReader {
  reader: IBinaryReader;
  cleanup: () => Promise<void>;
}

/**
 * Normalizes string file paths, in-memory buffers, and custom readers into a unified IBinaryReader.
 */
async function toReader(source: string | Uint8Array | IBinaryReader): Promise<ManagedReader> {
  if (typeof source === "string") {
    const handle = await open(source, "r");
    const stat = await handle.stat();
    return {
      reader: new FileHandleBinaryReader(handle, stat.size),
      cleanup: async () => {
        await handle.close();
      },
    };
  }

  if (source instanceof Uint8Array) {
    return {
      reader: new MemoryBinaryReader(source),
      cleanup: async () => {},
    };
  }

  return {
    reader: source,
    cleanup: async () => {},
  };
}

/**
 * Generates a compact binary PAKD delta patch transforming source archive into target archive.
 */
export async function createDelta(
  source: string | Uint8Array | IBinaryReader,
  target: string | Uint8Array | IBinaryReader
): Promise<Uint8Array> {
  const manifest = await createDeltaManifest(source, target);
  return serializeManifest(manifest);
}

/**
 * Generates a structured DeltaRecipeManifest object transforming source archive into target archive.
 */
export async function createDeltaManifest(
  source: string | Uint8Array | IBinaryReader,
  target: string | Uint8Array | IBinaryReader
): Promise<DeltaRecipeManifest> {
  const src = await toReader(source);
  const tgt = await toReader(target);

  try {
    const sourceIndex = await indexArchive(src.reader);
    const targetIndex = await indexArchive(tgt.reader);
    return await generateDeltaRecipe(src.reader, sourceIndex, tgt.reader, targetIndex);
  } finally {
    await Promise.all([src.cleanup(), tgt.cleanup()]);
  }
}

/**
 * Reconstitutes the target archive in memory from a baseline archive and delta recipe.
 * Accepts either raw binary PAKD container bytes or parsed DeltaRecipeManifest.
 */
export async function applyDelta(
  source: string | Uint8Array | IBinaryReader,
  delta: Uint8Array | DeltaRecipeManifest
): Promise<Uint8Array> {
  const manifest = delta instanceof Uint8Array ? deserializeManifest(delta) : delta;
  const src = await toReader(source);

  try {
    return await reconstituteArchive(src.reader, manifest);
  } finally {
    await src.cleanup();
  }
}

/**
 * Reconstitutes the target archive directly to a file on disk using atomic temporary staging.
 * Accepts either raw binary PAKD container bytes or parsed DeltaRecipeManifest.
 */
export async function applyDeltaToFile(
  source: string | Uint8Array | IBinaryReader,
  delta: Uint8Array | DeltaRecipeManifest,
  targetPath: string
): Promise<void> {
  const manifest = delta instanceof Uint8Array ? deserializeManifest(delta) : delta;
  const src = await toReader(source);

  try {
    await reconstituteArchiveToFile(src.reader, manifest, targetPath);
  } finally {
    await src.cleanup();
  }
}
