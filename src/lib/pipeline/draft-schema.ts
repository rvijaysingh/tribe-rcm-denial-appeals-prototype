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
  text: z
    .string()
    .describe(
      "One claim the letter makes, stated in the chart's own terms. Never restate a finding in the criteria clause's wording.",
    ),
  chart_line_ids: z
    .array(z.string())
    .describe(
      "Citation labels for the chart lines that state this claim, e.g. [\"L47\"]. Cite the exact line for each fact in the assertion, never a neighbouring line. Never a database key.",
    ),
  clause_ids: z
    .array(z.string())
    .describe("Criteria clause IDs this assertion argues, e.g. [\"C12\"]."),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export const DraftSectionSchema = z.object({
  name: z.enum(SECTION_NAMES),
  assertions: z.array(AssertionSchema),
});
export type DraftSection = z.infer<typeof DraftSectionSchema>;

export const DraftSchema = z.object({
  sections: z.array(DraftSectionSchema),
  /**
   * The bright line, stated for the model in the schema itself rather than
   * only in the prompt: this array is for required clauses the chart is SILENT
   * on. Thin support is not silence, and the difference decides the route.
   */
  unsupported_required: z
    .array(
      z.object({
        clause_id: z
          .string()
          .describe("A REQUIRED clause ID, e.g. \"C65\". Never a clause you argued anywhere in sections."),
        evidence_needed: z
          .string()
          .describe(
            "The specific document or result that would close the gap, concrete enough for a nurse to request it.",
          ),
      }),
    )
    .describe(
      "ONLY required clauses for which the chart contains no evidence whatsoever: the test was never performed, the value was never recorded, or the document is absent from the record you were given. " +
        "A clause with thin, partial, borderline or indirect support does NOT belong here. Argue that clause in criteria_argument with the evidence that does exist and lower draft_confidence instead. " +
        "Listing a clause here routes the whole case to 'needs docs', which sends a nurse to request records that may already be in the chart and discards the argument you could have made. Use an empty array when every required clause has some evidence.",
    ),
  draft_confidence: z
    .number()
    .describe("0 to 1: your confidence that what you wrote is accurate and complete enough to approve without edits."),
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
