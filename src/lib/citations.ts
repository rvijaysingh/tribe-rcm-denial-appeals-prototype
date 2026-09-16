/**
 * Citation label convention.
 *
 * Two identifier spaces exist for chart lines, and they must not be confused:
 *
 * - **Citation label**, e.g. `L47`. What the drafter sees, cites, and what the
 *   renderer prints in the letter. Line numbers run continuously across a
 *   case's documents, so a label is unique within a case but not across cases.
 * - **Database key**, e.g. `ACC-DEMO-03-L47`. The `chart_lines.id` primary key,
 *   which prefixes the account ID to stay unique across all cases.
 *
 * The model is never shown a database key: prefixes would waste tokens and
 * invite the model to invent account IDs. Everything crossing the boundary
 * goes through the helpers here, so the mapping lives in exactly one place.
 *
 * Criteria clauses need no such mapping. Their IDs (`C12`) are already global,
 * because clauses are shared reference data rather than per-case rows.
 */

/** Citation label for a line number: 47 -> "L47". */
export function lineLabel(lineNo: number): string {
  return `L${lineNo}`;
}

/** Database key for a line: ("ACC-DEMO-03", 47) -> "ACC-DEMO-03-L47". */
export function lineKey(accountId: string, lineNo: number): string {
  return `${accountId}-${lineLabel(lineNo)}`;
}

/** Line number from a citation label, or null when it is not a well-formed label. */
export function parseLineLabel(label: string): number | null {
  const match = /^L(\d+)$/.exec(label.trim());
  if (!match) return null;
  const lineNo = Number(match[1]);
  return Number.isInteger(lineNo) && lineNo > 0 ? lineNo : null;
}

/**
 * Database key for a citation label within a case, or null when the label is
 * malformed. A well-formed label for a line that does not exist still returns a
 * key; whether that key exists is the citation validity gate's job to decide.
 */
export function labelToKey(accountId: string, label: string): string | null {
  const lineNo = parseLineLabel(label);
  return lineNo === null ? null : lineKey(accountId, lineNo);
}

/** Citation label from a database key: "ACC-DEMO-03-L47" -> "L47". */
export function keyToLabel(key: string): string | null {
  const match = /-(L\d+)$/.exec(key);
  return match ? match[1] : null;
}

/** True when a string looks like a clause ID, e.g. "C12". */
export function isClauseId(id: string): boolean {
  return /^C\d+$/.test(id.trim());
}
