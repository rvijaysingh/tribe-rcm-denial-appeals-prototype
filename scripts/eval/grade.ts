/**
 * Grading and aggregation for the eval harness (PRD 9.2).
 *
 * Pure functions only: no database, no LLM, no clock. The harness runs the
 * pipeline and hands the results here, which keeps every metric definition in
 * one testable place and means a metric can be checked without spending money.
 *
 * Each metric below names the PRD 9.2 row it implements. Where the PRD's
 * wording left a choice, the choice is written down next to the code rather
 * than buried in a commit message.
 */

import type { EvalMetrics } from "../../src/lib/eval/metrics";
import type { GroundTruthCase } from "../../src/lib/db/queries";
import type { RunResult } from "../../src/lib/pipeline/orchestrator";

export interface CaseGrade {
  denialId: string;
  status: "completed" | "failed";
  error: string | null;
  expected: {
    category: string;
    rootCause: string;
    route: string;
    winnable: boolean;
    approveAsIs: boolean;
    metClauseIds: string[];
  };
  actual: {
    triageDecision: string;
    route: string | null;
    category: string | null;
    rootCause: string | null;
    classifyConfidence: number | null;
    draftConfidence: number | null;
    retrievedClauseIds: string[];
    precedentCount: number;
    searchedCategory: string | null;
    citationsValid: number;
    citationsTotal: number;
    requiredCovered: number;
    requiredTotal: number;
    assertions: number;
    flagged: number;
    judgeOverall: number | null;
    judgeFaithfulness: number | null;
    totalMs: number;
    totalCostUsd: number;
  };
  grades: {
    categoryCorrect: boolean | null;
    rootCauseCorrect: boolean | null;
    routeCorrect: boolean;
    /** Labeled met clauses that stage C retrieved, over all labeled met clauses. */
    clauseRecall: number | null;
    precedentHit: boolean | null;
    judgeAgrees: boolean | null;
    falseWriteOff: boolean;
  };
}

/** PRD 9.2 stage E: judge overall at or above this matches approve_as_is. */
export const JUDGE_AGREEMENT_THRESHOLD = 0.85;

/**
 * Was this case in scope for the false write-off metric at all?
 *
 * `winnable` in the seed means the clinical argument holds: no required clause
 * is unmet. It says nothing about economics, so a case can be winnable and
 * still be one the label expects triage to decline, for an expired filing
 * window or an expected value under the cost of working it.
 *
 * Those cases belong in neither half of the fraction. Counting them in the
 * denominator understates the rate; counting a correct decline in the
 * numerator calls the right answer an error, which is what the first version
 * of this metric did (PRD 9.2, corrected).
 */
export function inFalseWriteOffScope(truth: { winnable: boolean; expectedRoute: string }): boolean {
  return truth.winnable && truth.expectedRoute !== "do_not_appeal";
}

/**
 * A false write-off is a do-not-appeal on a case the label says should have
 * been worked. A do-not-appeal that matches the expected route is a correct
 * write-off and is not counted.
 */
export function isFalseWriteOff(
  truth: { winnable: boolean; expectedRoute: string },
  route: string | null,
): boolean {
  return inFalseWriteOffScope(truth) && route === "do_not_appeal";
}

export function gradeCase(truth: GroundTruthCase, result: RunResult): CaseGrade {
  const classify = result.classify;
  const retrieval = result.retrieval;
  const verification = result.verification;
  const draft = result.draft;

  const retrievedClauseIds = retrieval?.clauses.map((c) => c.id) ?? [];
  const retrieved = new Set(retrievedClauseIds);
  const met = truth.metClauseIds;

  // Clause recall@8: share of labeled met_clause_ids present in the retrieved
  // set. Undefined rather than 1.0 when the label lists no met clauses, so a
  // case with nothing to find cannot inflate the mean.
  const clauseRecall =
    retrieval === null || met.length === 0
      ? null
      : met.filter((id) => retrieved.has(id)).length / met.length;

  // Precedent recall@3: searchPrecedents already filters to overturned
  // precedents of the category it was given, so a non-empty result means a hit
  // only if that category was the right one. A misclassification that searched
  // the wrong shelf counts as a miss, which is what the metric is for.
  const precedentHit =
    retrieval === null
      ? null
      : retrieval.precedents.length > 0 && classify?.category === truth.category;

  const assertions = draft?.sections.reduce((n, s) => n + s.assertions.length, 0) ?? 0;
  const flagged = verification?.judge?.flagged_assertions.length ?? 0;

  const judgeOverall = verification?.judge?.overall ?? null;
  const judgeAgrees =
    judgeOverall === null ? null : judgeOverall >= JUDGE_AGREEMENT_THRESHOLD === truth.approveAsIs;

  return {
    denialId: truth.denialId,
    status: "completed",
    error: null,
    expected: {
      category: truth.category,
      rootCause: truth.rootCause,
      route: truth.expectedRoute,
      winnable: truth.winnable,
      approveAsIs: truth.approveAsIs,
      metClauseIds: met,
    },
    actual: {
      triageDecision: result.triage.decision,
      route: result.route,
      category: classify?.category ?? null,
      rootCause: classify?.root_cause ?? null,
      classifyConfidence: classify?.confidence ?? null,
      draftConfidence: draft?.draft_confidence ?? null,
      retrievedClauseIds,
      precedentCount: retrieval?.precedents.length ?? 0,
      searchedCategory: classify?.category ?? null,
      citationsValid: verification
        ? Math.round(verification.citation.validityRate * verification.citation.totalCitations)
        : 0,
      citationsTotal: verification?.citation.totalCitations ?? 0,
      requiredCovered: verification?.coverage.coveredRequiredClauseIds.length ?? 0,
      requiredTotal:
        (verification?.coverage.coveredRequiredClauseIds.length ?? 0) +
        (verification?.coverage.uncoveredRequiredClauseIds.length ?? 0),
      assertions,
      flagged,
      judgeOverall,
      judgeFaithfulness: verification?.judge?.faithfulness ?? null,
      totalMs: result.totalMs,
      totalCostUsd: result.totalCostUsd,
    },
    grades: {
      categoryCorrect: classify === null ? null : classify.category === truth.category,
      rootCauseCorrect: classify === null ? null : classify.root_cause === truth.rootCause,
      routeCorrect: result.route === truth.expectedRoute,
      clauseRecall,
      precedentHit,
      judgeAgrees,
      falseWriteOff: isFalseWriteOff(truth, result.route),
    },
  };
}

export function failedCase(truth: GroundTruthCase, error: string): CaseGrade {
  return {
    denialId: truth.denialId,
    status: "failed",
    error,
    expected: {
      category: truth.category,
      rootCause: truth.rootCause,
      route: truth.expectedRoute,
      winnable: truth.winnable,
      approveAsIs: truth.approveAsIs,
      metClauseIds: truth.metClauseIds,
    },
    actual: {
      triageDecision: "none",
      route: null,
      category: null,
      rootCause: null,
      classifyConfidence: null,
      draftConfidence: null,
      retrievedClauseIds: [],
      precedentCount: 0,
      searchedCategory: null,
      citationsValid: 0,
      citationsTotal: 0,
      requiredCovered: 0,
      requiredTotal: 0,
      assertions: 0,
      flagged: 0,
      judgeOverall: null,
      judgeFaithfulness: null,
      totalMs: 0,
      totalCostUsd: 0,
    },
    grades: {
      categoryCorrect: null,
      rootCauseCorrect: null,
      // A crashed run did not produce the expected route. Counting it as a
      // route miss keeps route accuracy honest about pipeline failures.
      routeCorrect: false,
      clauseRecall: null,
      precedentHit: null,
      judgeAgrees: null,
      falseWriteOff: false,
    },
  };
}

/** Linear interpolation, matching Postgres percentile_cont. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function meanOf(values: readonly number[]): { value: number; n: number } | null {
  if (values.length === 0) return null;
  return { value: values.reduce((a, b) => a + b, 0) / values.length, n: values.length };
}

export interface AggregateOptions {
  /** Vitest pass counts, or null when the suite was not run with the eval. */
  ruleTests: { n: number; of: number } | null;
  /**
   * Approve-as-is over all reviewed runs. Eval runs are not reviewed by a
   * nurse, so this is null unless the caller has reviewer feedback to supply.
   */
  reviewerAgreement: { n: number; of: number } | null;
}

/** Roll per-case grades up into the PRD 9.2 metric set. */
export function aggregate(grades: readonly CaseGrade[], options: AggregateOptions): EvalMetrics {
  const completed = grades.filter((g) => g.status === "completed");
  const classified = completed.filter((g) => g.grades.categoryCorrect !== null);
  const retrieved = completed.filter((g) => g.grades.precedentHit !== null);
  const judged = completed.filter((g) => g.grades.judgeAgrees !== null);

  const correctConfidences = classified
    .filter((g) => g.grades.categoryCorrect === true)
    .map((g) => g.actual.classifyConfidence)
    .filter((c): c is number => c !== null);
  const incorrectConfidences = classified
    .filter((g) => g.grades.categoryCorrect === false)
    .map((g) => g.actual.classifyConfidence)
    .filter((c): c is number => c !== null);

  const recalls = completed
    .map((g) => g.grades.clauseRecall)
    .filter((r): r is number => r !== null);

  const latencies = completed.map((g) => g.actual.totalMs);
  const costs = completed.map((g) => g.actual.totalCostUsd);

  const sum = (pick: (g: CaseGrade) => number): number =>
    completed.reduce((total, g) => total + pick(g), 0);

  const assertions = sum((g) => g.actual.assertions);
  const flagged = sum((g) => g.actual.flagged);

  return {
    a: {
      falseWriteOff: {
        n: completed.filter((g) => g.grades.falseWriteOff).length,
        of: completed.filter((g) =>
          inFalseWriteOffScope({ winnable: g.expected.winnable, expectedRoute: g.expected.route }),
        ).length,
      },
      ruleTests: options.ruleTests,
    },
    b: {
      categoryAccuracy: {
        n: classified.filter((g) => g.grades.categoryCorrect).length,
        of: classified.length,
      },
      rootCauseAccuracy: {
        n: classified.filter((g) => g.grades.rootCauseCorrect).length,
        of: classified.length,
      },
      confidenceCorrect: meanOf(correctConfidences),
      confidenceIncorrect: meanOf(incorrectConfidences),
    },
    c: {
      clauseRecallAt8: meanOf(recalls) ?? { value: 0, n: 0 },
      precedentRecallAt3: {
        n: retrieved.filter((g) => g.grades.precedentHit).length,
        of: retrieved.length,
      },
    },
    d: {
      // Pooled over every citation in the split rather than averaged per case,
      // which is what "cited IDs that exist / all cited IDs" says.
      citationValidity: { n: sum((g) => g.actual.citationsValid), of: sum((g) => g.actual.citationsTotal) },
      criteriaCoverage: { n: sum((g) => g.actual.requiredCovered), of: sum((g) => g.actual.requiredTotal) },
      // Assertions the judge did not flag, over all assertions. The judge is
      // capped at 3 flags per case, so on a case with more than 3 bad
      // assertions this reads high. Per-case judge faithfulness scores are in
      // per_case_json for anyone who wants the uncapped view.
      faithfulness: { n: assertions - flagged, of: assertions },
    },
    e: {
      routeAccuracy: {
        n: grades.filter((g) => g.grades.routeCorrect).length,
        of: grades.length,
      },
      judgeAgreement: {
        n: judged.filter((g) => g.grades.judgeAgrees).length,
        of: judged.length,
      },
    },
    e2e: {
      pipelineMsMedian: Math.round(percentile(latencies, 0.5)),
      pipelineMsP90: Math.round(percentile(latencies, 0.9)),
      costUsdMedian: percentile(costs, 0.5),
      costUsdP90: percentile(costs, 0.9),
      reviewerAgreement: options.reviewerAgreement,
      completed: { n: completed.length, of: grades.length },
      errors: grades.length - completed.length,
    },
  };
}
