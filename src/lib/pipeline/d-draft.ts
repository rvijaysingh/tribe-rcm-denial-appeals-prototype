/**
 * Stage D: draft the appeal (PRD 7 stage D).
 *
 * The model never writes letter prose. It emits assertions, each citing the
 * chart lines and criteria clauses that support it, and src/lib/render turns
 * that into the letter deterministically.
 *
 * The criteria block lives in the system prompt so it sits inside the cached
 * prefix (PRD 7, orchestrator): it is stable for a payer and condition, while
 * the chart and the denial change per case and belong in the user message.
 *
 * checkDraft enforces structure only. It deliberately does not verify that a
 * cited ID exists, because citation validity is a measured metric (PRD 9.2
 * stage D) that stage E computes. Retrying until the model stopped inventing
 * IDs would drive that metric to 100% and make it meaningless.
 */

import { isClauseId, parseLineLabel } from "../citations";
import type { DenialCategory } from "../domain";
import { generateStructured } from "../llm";
import { MODELS } from "../models";
import { loadStagePrompts, renderTemplate } from "../prompts";
import { DraftSchema, SECTIONS_WITHOUT_CHART_CITATIONS, type Draft } from "./draft-schema";
import type { RetrievedClause, RetrievedPrecedent } from "./c-retrieve";

export const DRAFT_PROMPT_VERSION = "draft.v1";

const CATEGORY_LABEL: Record<DenialCategory, string> = {
  medical_necessity: "medical necessity",
  level_of_care: "level of care, inpatient versus observation",
};

export interface DraftInput {
  payerName: string;
  appealFormatNotes: string;
  conditionLabel: string;
  drg: string;
  category: DenialCategory;
  rootCauseStatement: string;
  keyFacts: string[];
  clauses: RetrievedClause[];
  precedents: RetrievedPrecedent[];
  /** Chart lines already formatted as "L47: text". */
  chartText: string;
}

/** The criteria block that goes in the cached system prefix. */
export function formatClauseBlock(clauses: RetrievedClause[]): string {
  return clauses
    .map((c) => `${c.id} (${c.code})${c.required ? " [REQUIRED]" : ""}: ${c.text}`)
    .join("\n");
}

export function renderDraftPrompt(input: DraftInput): { system: string; user: string } {
  const { system, userTemplate } = loadStagePrompts("draft", DRAFT_PROMPT_VERSION.split(".")[1]);
  const precedentsBlock =
    input.precedents.length > 0
      ? `PRECEDENTS. Appeals this payer has overturned. Reference them in the precedent section only, and cite chart lines for any clinical claim.\n${input.precedents
          .map((p) => `${p.id}: ${p.summary}`)
          .join("\n")}\n`
      : "";

  return {
    system: `${system}\n\n${formatClauseBlock(input.clauses)}\n`,
    user: renderTemplate(userTemplate, {
      payer_name: input.payerName,
      appeal_format_notes: input.appealFormatNotes,
      condition_label: input.conditionLabel,
      drg: input.drg,
      category_label: CATEGORY_LABEL[input.category],
      root_cause_statement: input.rootCauseStatement,
      key_facts: input.keyFacts.map((f) => `- ${f}`).join("\n"),
      precedents_block: precedentsBlock,
      chart: input.chartText,
    }),
  };
}

/**
 * Structural checks only. Citation existence is measured, not enforced; see the
 * module header.
 */
export function checkDraft(draft: Draft): string | null {
  const problems: string[] = [];
  const names = draft.sections.map((s) => s.name);

  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length > 0) problems.push(`duplicate section(s): ${[...new Set(duplicates)].join(", ")}`);
  for (const required of ["criteria_argument", "request"] as const) {
    if (!names.includes(required)) problems.push(`missing the ${required} section`);
  }

  for (const section of draft.sections) {
    if (section.assertions.length === 0) {
      problems.push(`section ${section.name} has no assertions; omit the section instead`);
    }
    section.assertions.forEach((assertion, i) => {
      const where = `${section.name} assertion ${i + 1}`;
      if (assertion.text.trim().length === 0) problems.push(`${where} has empty text`);

      const malformedLines = assertion.chart_line_ids.filter((id) => parseLineLabel(id) === null);
      if (malformedLines.length > 0) {
        problems.push(`${where} has malformed chart line ID(s): ${malformedLines.join(", ")}. Use the form L47.`);
      }
      const malformedClauses = assertion.clause_ids.filter((id) => !isClauseId(id));
      if (malformedClauses.length > 0) {
        problems.push(`${where} has malformed clause ID(s): ${malformedClauses.join(", ")}. Use the form C12.`);
      }
      if (!SECTIONS_WITHOUT_CHART_CITATIONS.has(section.name) && assertion.chart_line_ids.length === 0) {
        problems.push(`${where} cites no chart line; every assertion outside intro and request must cite one`);
      }
      if (section.name === "criteria_argument" && assertion.clause_ids.length === 0) {
        problems.push(`${where} cites no criteria clause; every criteria_argument assertion must cite one`);
      }
    });
  }

  const argued = new Set(
    draft.sections
      .filter((s) => s.name === "criteria_argument")
      .flatMap((s) => s.assertions.flatMap((a) => a.clause_ids)),
  );
  for (const gap of draft.unsupported_required) {
    if (!isClauseId(gap.clause_id)) {
      problems.push(`unsupported_required has malformed clause ID "${gap.clause_id}"`);
    }
    if (gap.evidence_needed.trim().length === 0) {
      problems.push(`unsupported_required ${gap.clause_id} does not say what evidence is needed`);
    }
    // A clause cannot be both conceded as unsupported and argued as met. The
    // nurse reads the letter and the gap list side by side.
    if (argued.has(gap.clause_id)) {
      problems.push(
        `${gap.clause_id} is listed in unsupported_required but is also argued in criteria_argument. ` +
          `Either drop it from unsupported_required or stop arguing it.`,
      );
    }
  }

  if (!(draft.draft_confidence >= 0 && draft.draft_confidence <= 1)) {
    problems.push(`draft_confidence ${draft.draft_confidence} is outside 0 to 1`);
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

export async function draft(input: DraftInput, onText?: (chunk: string) => void) {
  const { system, user } = renderDraftPrompt(input);
  return generateStructured({
    label: "stage-d-draft",
    model: MODELS.draft,
    system,
    prompt: user,
    schema: DraftSchema,
    maxTokens: 16000,
    effort: "medium",
    cacheSystem: true,
    normalize: (d) => ({
      ...d,
      sections: d.sections.map((s) => ({
        ...s,
        assertions: s.assertions.map((a) => ({
          ...a,
          text: a.text.replace(/\s*—\s*/g, " - ").trim(),
          chart_line_ids: a.chart_line_ids.map((id) => id.trim()),
          clause_ids: a.clause_ids.map((id) => id.trim()),
        })),
      })),
    }),
    check: checkDraft,
    onText,
  });
}
