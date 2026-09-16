/**
 * Deterministic text checks used by the seed passes and their tests.
 *
 * - Term matching. A plain term matches as a whole word or phrase, allowing a
 *   plural "s" or "es": "BUN" matches "BUN 34" but not "bundle", and
 *   "antibiotic" matches "antibiotics". A term ending in "*" is a stem:
 *   "confus*" matches "confused" and "confusion".
 * - Shingle overlap, the leakage check: generated charts must not share a
 *   run of N words with any criteria clause text.
 * - Date, name, and dash patterns shared by the chart and letter checks.
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

/**
 * Calendar dates (M/D/YYYY), plausible years (1950 to 2039) not followed by a
 * unit, and whole-word month names followed by a day. Deliberately misses
 * "May 3": the verb "may" is too common in clinical text.
 *
 * Does not match: BP 118/72, 2000 mL, "decreased 2L", "may 3 doses".
 */
export const CALENDAR_DATE = new RegExp(
  [
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    String.raw`\b(?:19[5-9]\d|20[0-3]\d)\b(?!\s*(?:ml|mg|mcg|cc|l\b|units?|kcal|%))`,
    String.raw`\b(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.? \d{1,2}\b`,
  ].join("|"),
  "i",
);

/** An honorific followed by a capitalized name, e.g. "Dr. Alvarez". */
export const PERSON_NAME = /\b(?:Dr|Mr|Mrs|Ms)\.? [A-Z][a-z]+/;

/** Replace em and en dashes with hyphens. Applied to accepted model output. */
export function normalizeDashes(text: string): string {
  return text.replace(/\s*—\s*/g, " - ").replace(/–/g, "-");
}
