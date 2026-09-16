/**
 * Deterministic text checks used by the seed passes and their tests.
 *
 * - Term matching. A plain term matches as a whole word or phrase, allowing a
 *   plural "s" or "es": "BUN" matches "BUN 34" but not "bundle", and
 *   "antibiotic" matches "antibiotics". A term ending in "*" is a stem:
 *   "confus*" matches "confused" and "confusion".
 * - Shingle overlap, the leakage check: generated charts must not share a
 *   run of N words with any criteria clause text.
 */

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `term` appears in `text` per the matching rules above. Case-insensitive. */
export function containsTerm(text: string, term: string): boolean {
  const isStem = term.endsWith("*");
  const core = escapeRegex((isStem ? term.slice(0, -1) : term).toLowerCase());
  const tail = isStem ? "" : "(?:e?s)?(?![a-z0-9])";
  return new RegExp(`(?<![a-z0-9])${core}${tail}`, "i").test(text);
}

/** The terms from `terms` that appear in `text`. */
export function matchedTerms(text: string, terms: readonly string[]): string[] {
  return terms.filter((term) => containsTerm(text, term));
}

/** Lowercased word tokens, punctuation stripped. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%./-]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Every run of `n` consecutive tokens, joined by spaces. */
export function shingles(text: string, n: number): Set<string> {
  const tokens = tokenize(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

/** The N-word phrases shared between `text` and any of `sources`. */
export function sharedShingles(text: string, sources: readonly string[], n: number): string[] {
  const inText = shingles(text, n);
  const shared = new Set<string>();
  for (const source of sources) {
    for (const s of shingles(source, n)) {
      if (inText.has(s)) shared.add(s);
    }
  }
  return [...shared];
}

/** Shingle length for the leakage check. Short enough to catch copied clauses, long enough to ignore common clinical phrases. */
export const LEAKAGE_SHINGLE = 6;
