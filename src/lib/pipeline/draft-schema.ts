/**
 * The structured draft: stage D's output shape (PRD 7 stage D).
 *
 * The model never writes letter prose. It emits assertions, each carrying the
 * chart lines and criteria clauses that support it, and src/lib/render turns
 * that into letter text deterministically. Keeping the two apart is what makes
 * every sentence in the letter traceable.
 *
 * Shape only, no size limits: structured outputs cannot enforce string lengths
 * or array bounds, so a violation there would be a fatal parse error instead of
 * something the stage can retry. Structural rules live in checkDraft().
 */

import { z } from "zod";
import { SECTION_NAMES } from "../domain";

export const AssertionSchema = z.object({
  text: z.string(),
  /** Citation labels, e.g. ["L47"]. Never database keys. */
  chart_line_ids: z.array(z.string()),
  /** Clause IDs, e.g. ["C12"]. */
  clause_ids: z.array(z.string()),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export const DraftSectionSchema = z.object({
  name: z.enum(SECTION_NAMES),
  assertions: z.array(AssertionSchema),
});
export type DraftSection = z.infer<typeof DraftSectionSchema>;

export const DraftSchema = z.object({
  sections: z.array(DraftSectionSchema),
  /** Required clauses the chart cannot support, with what evidence would close the gap. */
  unsupported_required: z.array(
    z.object({
      clause_id: z.string(),
      evidence_needed: z.string(),
    }),
  ),
  draft_confidence: z.number(),
});
export type Draft = z.infer<typeof DraftSchema>;

/** Sections where an assertion may stand without a chart citation (PRD 7 stage D). */
export const SECTIONS_WITHOUT_CHART_CITATIONS = new Set(["intro", "request"]);

/** Every assertion in the draft, with the section it came from. */
export function allAssertions(draft: Draft): { section: DraftSection["name"]; assertion: Assertion }[] {
  return draft.sections.flatMap((section) =>
    section.assertions.map((assertion) => ({ section: section.name, assertion })),
  );
}
