/**
 * Seed artifact I/O.
 *
 * Every pass writes its output to scripts/seed/data/ as committed JSON. The
 * committed files are the dataset: the split is fixed because the files are
 * fixed, and LLM-generated passes (C, D) are never rerun unless asked for.
 * Paths resolve from the repo root, where npm scripts run.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve("scripts/seed/data");

function resolve(relative: string): string {
  return path.join(DATA_DIR, relative);
}

/** Stable JSON: two-space indent and a trailing newline, for clean diffs. */
function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Write an artifact. Returns true when the content changed on disk. */
export function writeArtifact(relative: string, data: unknown): boolean {
  const file = resolve(relative);
  const next = serialize(data);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (previous === next) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
  return true;
}

/** Read an artifact, or undefined when it does not exist yet. */
export function readArtifact<T>(relative: string): T | undefined {
  const file = resolve(relative);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Artifact ${file} is not valid JSON: ${(error as Error).message}`);
  }
}

export function artifactExists(relative: string): boolean {
  return existsSync(resolve(relative));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
