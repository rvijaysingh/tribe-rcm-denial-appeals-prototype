/**
 * Loads seed prompt templates from scripts/seed/prompts/ and fills
 * {{placeholders}}. Throws on a missing template, an unfilled placeholder, or
 * an unused variable, so a template edit cannot silently drop an input.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const PROMPT_DIR = path.resolve("scripts/seed/prompts");

export function loadPrompt(fileName: string): string {
  const file = path.join(PROMPT_DIR, fileName);
  try {
    return readFileSync(file, "utf8");
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
