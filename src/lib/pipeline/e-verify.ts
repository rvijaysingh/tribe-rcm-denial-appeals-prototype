/**
 * Stage E: verify and route (PRD 7 stage E).
 *
 * Deterministic gates run first, then an LLM judge, then routing. The order
 * matters: the gates are cheap and certain, and one of them ends the stage
 * without spending anything on the judge.
 *
 * The judge uses a different model from the drafter and is shown the source
 * material, not just the letter (PRD 9.3).
 */

import { z } from "zod";
import { parseLineLabel } from "../citations";
import { READY_THRESHOLD, REVIEW_THRESHOLD } from "../economics";
import type { Route } from "../domain";
import { generateStructured } from "../llm";
import { MODELS } from "../models";
import { loadStagePrompts, renderTemplate } from "../prompts";
import { allAssertions, type Draft } from "./draft-schema";
import type { RetrievedClause, RetrievedPrecedent } from "./c-retrieve";

export const VERIFY_PROMPT_VERSION = "verify.v1";

// ------------------------------------------------------------------- gates

export interface CitationCheck {
  /** Cited IDs that exist / all cited IDs. 1 when the draft cites nothing. */
  validityRate: number;
  totalCitations: number;
  invalidChartLineIds: string[];
  invalidClauseIds: string[];
}

/**
 * Citation validity: every cited chart line must exist in this case's chart,
 * and every cited clause must be one stage C retrieved. Malformed labels count
 * as invalid, not as errors: the measurement is what a reviewer would find.
 */
export function checkCitations(
  draft: Draft,
  validLineNumbers: ReadonlySet<number>,
  retrievedClauseIds: ReadonlySet<string>,
): CitationCheck {
  const invalidChartLineIds: string[] = [];
  const invalidClauseIds: string[] = [];
  let total = 0;
  let valid = 0;

  for (const { assertion } of allAssertions(draft)) {
    for (const id of assertion.chart_line_ids) {
      total += 1;
      const lineNo = parseLineLabel(id);
      if (lineNo !== null && validLineNumbers.has(lineNo)) valid += 1;
      else invalidChartLineIds.push(id);
    }
    for (const id of assertion.clause_ids) {
      total += 1;
      if (retrievedClauseIds.has(id)) valid += 1;
      else invalidClauseIds.push(id);
    }
  }

  return {
    validityRate: total === 0 ? 1 : valid / total,
    totalCitations: total,
    invalidChartLineIds: [...new Set(invalidChartLineIds)],
    invalidClauseIds: [...new Set(invalidClauseIds)],
  };
}

export interface CoverageCheck {
  /** Required clauses with at least one citing assertion / all required clauses. */
  coverage: number;
  coveredRequiredClauseIds: string[];
  uncoveredRequiredClauseIds: string[];
}

/** Criteria coverage across every required clause in the payer's set. */
export function checkCoverage(draft: Draft, requiredClauseIds: readonly string[]): CoverageCheck {
  const cited = new Set(allAssertions(draft).flatMap(({ assertion }) => assertion.clause_ids));
  const covered = requiredClauseIds.filter((id) => cited.has(id));
  const uncovered = requiredClauseIds.filter((id) => !cited.has(id));
  return {
    coverage: requiredClauseIds.length === 0 ? 1 : covered.length / requiredClauseIds.length,
    coveredRequiredClauseIds: covered,
    uncoveredRequiredClauseIds: uncovered,
  };
}

// ------------------------------------------------------------------- judge

export const JudgeSchema = z.object({
  faithfulness: z.number(),
  completeness: z.number(),
  tone: z.number(),
  overall: z.number(),
  flagged_assertions: z.array(z.object({ assertion_text: z.string(), reason: z.string() })),
});
export type JudgeOutput = z.infer<typeof JudgeSchema>;

export function checkJudge(output: JudgeOutput): string | null {
  const problems: string[] = [];
  for (const [name, value] of Object.entries({
    faithfulness: output.faithfulness,
    completeness: output.completeness,
    tone: output.tone,
    overall: output.overall,
  })) {
    if (!(value >= 0 && value <= 1)) problems.push(`${name} ${value} is outside 0 to 1`);
  }
  if (output.flagged_assertions.length > 3) {
    problems.push(`${output.flagged_assertions.length} flagged assertions; at most 3 are allowed`);
  }
  for (const flag of output.flagged_assertions) {
    if (flag.assertion_text.trim().length === 0) problems.push("a flagged assertion has empty text");
    if (flag.reason.trim().length === 0) problems.push("a flagged assertion has no reason");
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

export interface JudgeInput {
  letterText: string;
  chartText: string;
  clauses: RetrievedClause[];
  /**
   * The precedents stage C retrieved. The judge must see these. A judge shown
   * only the chart and clauses flags every precedent reference in the letter as
   * fabricated, because it has no way to check one. PRD 9.3 requires the judge
   * to see the source material, and precedents are source material.
   */
  precedents: RetrievedPrecedent[];
}

export function renderJudgePrompt(input: JudgeInput): { system: string; user: string } {
  const { system, userTemplate } = loadStagePrompts("verify", VERIFY_PROMPT_VERSION.split(".")[1]);
  return {
    system,
    user: renderTemplate(userTemplate, {
      clauses: input.clauses.map((c) => `${c.id} (${c.code})${c.required ? " [REQUIRED]" : ""}: ${c.text}`).join("\n"),
      precedents_block:
        input.precedents.length > 0
          ? `PRECEDENTS the drafter was given. A reference to one of these is supported. A claim about this payer's history that is not here is not.\n${input.precedents
              .map((p) => `${p.id}: ${p.summary}`)
              .join("\n")}\n`
          : "PRECEDENTS the drafter was given: none. Any claim about this payer's prior decisions is unsupported.\n",
      chart: input.chartText,
      letter: input.letterText.trim(),
    }),
  };
}

export async function judge(input: JudgeInput, onText?: (chunk: string) => void) {
  const { system, user } = renderJudgePrompt(input);
  return generateStructured({
    label: "stage-e-judge",
    model: MODELS.verify,
    system,
    prompt: user,
    schema: JudgeSchema,
    maxTokens: 8000,
    // The judge reads the whole chart against the letter. At medium effort it
    // skimmed and flagged accurate assertions on phrasing.
    effort: "high",
    cacheSystem: true,
    check: checkJudge,
    onText,
  });
}

// ----------------------------------------------------------------- routing

export interface RouteInput {
  hasUnsupportedRequired: boolean;
  classifyConfidence: number;
  draftConfidence: number;
  judgeOverall: number | null;
  validityRate: number;
  flaggedCount: number;
}

export interface RouteDecision {
  route: Route;
  route_reason: string;
  /** min(classify, draft, judge). Null when the judge was skipped. */
  composite: number | null;
}

/**
 * Routing (PRD 7 stage E).
 *
 * Note on a gap in the PRD: it defines needs_review for a composite from 0.60
 * up to 0.85 but names no route below 0.60. Rather than invent a fifth route,
 * anything under the review threshold also routes to needs_review, with the
 * reason saying so. A low-confidence draft still needs a human, and there is
 * nowhere else for it to go.
 */
export function decideRoute(input: RouteInput): RouteDecision {
  if (input.hasUnsupportedRequired) {
    return {
      route: "needs_docs",
      route_reason: "A required criterion has no support in the chart. The draft lists the evidence needed.",
      composite: null,
    };
  }

  const composite = Math.min(input.classifyConfidence, input.draftConfidence, input.judgeOverall ?? 1);
  const reasons: string[] = [];
  if (composite < READY_THRESHOLD) reasons.push(`confidence ${composite.toFixed(2)} is under ${READY_THRESHOLD}`);
  if (input.validityRate < 1) reasons.push(`citation validity ${(input.validityRate * 100).toFixed(0)}% is under 100%`);
  if (input.flaggedCount > 0) {
    reasons.push(`the reviewer model flagged ${input.flaggedCount} assertion(s)`);
  }

  if (reasons.length === 0) {
    return {
      route: "ready",
      route_reason: `Confidence ${composite.toFixed(2)}, every citation checks out, nothing flagged.`,
      composite,
    };
  }
  return {
    route: "needs_review",
    route_reason: `Needs a close read: ${reasons.join("; ")}.` +
      (composite < REVIEW_THRESHOLD ? " Confidence is below the review threshold, so read it in full." : ""),
    composite,
  };
}

// ------------------------------------------------------------------ stage

export interface VerifyResult {
  citation: CitationCheck;
  coverage: CoverageCheck;
  judge: JudgeOutput | null;
  decision: RouteDecision;
  /** Null when the judge was skipped by the needs_docs gate. */
  usage: { tokensIn: number; tokensOut: number; cacheReadTokens: number; costUsd: number } | null;
}

export interface VerifyInput extends JudgeInput {
  draft: Draft;
  validLineNumbers: ReadonlySet<number>;
  retrievedClauseIds: ReadonlySet<string>;
  requiredClauseIds: readonly string[];
  classifyConfidence: number;
}

/** Run the gates, then the judge when the gates allow it, then route. */
export async function verify(input: VerifyInput, onText?: (chunk: string) => void): Promise<VerifyResult> {
  const citation = checkCitations(input.draft, input.validLineNumbers, input.retrievedClauseIds);
  const coverage = checkCoverage(input.draft, input.requiredClauseIds);
  const hasUnsupportedRequired = input.draft.unsupported_required.length > 0;

  // The needs_docs gate ends the stage: no letter is going out, so there is
  // nothing worth paying a judge to read.
  if (hasUnsupportedRequired) {
    return {
      citation,
      coverage,
      judge: null,
      decision: decideRoute({
        hasUnsupportedRequired: true,
        classifyConfidence: input.classifyConfidence,
        draftConfidence: input.draft.draft_confidence,
        judgeOverall: null,
        validityRate: citation.validityRate,
        flaggedCount: 0,
      }),
      usage: null,
    };
  }

  const result = await judge(
    {
      letterText: input.letterText,
      chartText: input.chartText,
      clauses: input.clauses,
      precedents: input.precedents,
    },
    onText,
  );

  return {
    citation,
    coverage,
    judge: result.data,
    decision: decideRoute({
      hasUnsupportedRequired: false,
      classifyConfidence: input.classifyConfidence,
      draftConfidence: input.draft.draft_confidence,
      judgeOverall: result.data.overall,
      validityRate: citation.validityRate,
      flaggedCount: result.data.flagged_assertions.length,
    }),
    usage: {
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      cacheReadTokens: result.cacheReadTokens,
      costUsd: result.costUsd,
    },
  };
}
