/**
 * Pipeline prompt templates.
 *
 * One file per prompt with the version in the filename, so a prompt change is
 * a visible diff and the version recorded on a run points at an exact file.
 * Templates fill {{placeholders}} and throw on a missing value or an unused
 * variable, so editing a template cannot silently drop an input.
 *
 * Templates are read from disk at call time rather than bundled, which keeps
 * them editable without a rebuild. Paths resolve from the repo root, which is
 * the working directory for both npm scripts and the Next.js server.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const PROMPT_DIR = path.resolve("src/lib/prompts");

const cache = new Map<string, string>();

export function loadPrompt(fileName: string): string {
  const cached = cache.get(fileName);
  if (cached !== undefined) return cached;

  const file = path.join(PROMPT_DIR, fileName);
  try {
    const text = readFileSync(file, "utf8");
    cache.set(fileName, text);
    return text;
  } catch (error) {
    throw new Error(`Prompt template ${file} could not be read: ${(error as Error).message}`);
  }
}

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  const used = new Set<string>();
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Template placeholder {{${name}}} has no value`);
    used.add(name);
    return String(vars[name]);
  });
  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length > 0) throw new Error(`Template variables not used: ${unused.join(", ")}`);
  return rendered;
}

/** Load a system and user template pair for a stage, e.g. ("classify", "v1"). */
export function loadStagePrompts(stage: string, version: string): { system: string; userTemplate: string } {
  return {
    system: loadPrompt(`${stage}-system.${version}.md`),
    userTemplate: loadPrompt(`${stage}-user.${version}.md`),
  };
}
