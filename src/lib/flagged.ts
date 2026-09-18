/**
 * Matching a judge's flag back to the assertion it is about.
 *
 * The judge is asked to quote the assertion it flagged, and mostly it does.
 * But it also paraphrases, truncates the middle with an ellipsis, and prefixes
 * the clause code it was arguing about. On real runs only about one flag in
 * four comes back as an exact string.
 *
 * The UI used to key off exact equality, which silently broke four things at
 * once whenever the judge did any of that: the amber highlight in the draft,
 * the warning on the evidence row, the jump from the flag card, and the
 * editor opening on the flagged sentence. All of them now resolve through
 * here, and a flag that genuinely cannot be matched resolves to null so the
 * UI can say so rather than look broken.
 */

export interface AssertionRef {
  /** Stable id, assigned by position so it survives a paraphrase. */
  id: string;
  text: string;
}

/** Lowercase, strip punctuation and collapse whitespace, for comparison only. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop a leading criteria code, e.g. "SEP-01: " or "CHF-07 is met ...". The
 * judge often opens with the clause under discussion, which the assertion
 * itself may not repeat.
 */
function stripClausePrefix(text: string): string {
  return text.replace(/^\s*[A-Z]{2,5}-\d{1,3}\s*[:\-–]?\s*/, "");
}

/** The pieces of a flag either side of an ellipsis, longest first. */
function fragments(text: string): string[] {
  return text
    .split(/\.{3}|…/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .sort((a, b) => b.length - a.length);
}

function wordSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((w) => w.length > 3));
}

/** Share of the flag's distinctive words that also appear in the assertion. */
function overlapRatio(flag: string, assertion: string): number {
  const flagWords = wordSet(flag);
  if (flagWords.size === 0) return 0;
  const assertionWords = wordSet(assertion);
  let hits = 0;
  for (const word of flagWords) if (assertionWords.has(word)) hits += 1;
  return hits / flagWords.size;
}

/** A fragment shorter than this is too generic to match on. */
const MIN_FRAGMENT_CHARS = 24;
/** Below this share of shared words, a paraphrase is not convincing. */
const MIN_OVERLAP = 0.6;

/**
 * The id of the assertion a flag refers to, or null when nothing matches well
 * enough to be worth jumping to.
 *
 * Tried in order, most certain first:
 *   1. exact text, then exact after normalising
 *   2. containment of the flag's longest fragment, which handles both an
 *      ellipsis in the middle and a clause-code prefix
 *   3. word overlap, for an outright paraphrase, above a threshold
 */
export function resolveFlagTarget(flagText: string, assertions: readonly AssertionRef[]): string | null {
  if (assertions.length === 0) return null;

  const raw = flagText.trim();
  const exact = assertions.find((a) => a.text.trim() === raw);
  if (exact) return exact.id;

  const normFlag = normalize(raw);
  const normExact = assertions.find((a) => normalize(a.text) === normFlag);
  if (normExact) return normExact.id;

  for (const fragment of fragments(stripClausePrefix(raw))) {
    if (fragment.length < MIN_FRAGMENT_CHARS) continue;
    const normFragment = normalize(fragment);
    if (normFragment.length === 0) continue;
    const contained = assertions.find((a) => normalize(a.text).includes(normFragment));
    if (contained) return contained.id;
    // The other direction: the judge quoted more than the assertion says.
    const contains = assertions.find((a) => normFragment.includes(normalize(a.text)));
    if (contains) return contains.id;
  }

  let best: { id: string; score: number } | null = null;
  for (const assertion of assertions) {
    const score = overlapRatio(stripClausePrefix(raw), assertion.text);
    if (!best || score > best.score) best = { id: assertion.id, score };
  }
  return best && best.score >= MIN_OVERLAP ? best.id : null;
}

/**
 * Resolve every flag at once. Returns the target id per flag, by index, and
 * the set of assertion ids that carry a flag.
 */
export function resolveFlagTargets(
  flagTexts: readonly string[],
  assertions: readonly AssertionRef[],
): { targets: (string | null)[]; flaggedIds: Set<string> } {
  const targets = flagTexts.map((text) => resolveFlagTarget(text, assertions));
  return { targets, flaggedIds: new Set(targets.filter((id): id is string => id !== null)) };
}
