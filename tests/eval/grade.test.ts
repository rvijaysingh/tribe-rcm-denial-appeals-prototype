import { describe, expect, it } from "vitest";
import {
  aggregate,
  failedCase,
  gradeCase,
  inFalseWriteOffScope,
  isFalseWriteOff,
  percentile,
  type CaseGrade,
} from "../../scripts/eval/grade";
import type { GroundTruthCase } from "../../src/lib/db/queries";
import type { RunResult } from "../../src/lib/pipeline/orchestrator";
import { evalMetricsSchema } from "../../src/lib/eval/metrics";

function truth(overrides: Partial<GroundTruthCase> = {}): GroundTruthCase {
  return {
    denialId: "ACC-TEST-01",
    category: "medical_necessity",
    rootCause: "severity_not_documented",
    metClauseIds: ["C1", "C2", "C3", "C4"],
    unmetRequiredClauseIds: [],
    expectedRoute: "ready",
    winnable: true,
    approveAsIs: true,
    ...overrides,
  };
}

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: "RUN-1",
    denialId: "ACC-TEST-01",
    route: "ready",
    routeReason: "clean",
    totalMs: 40000,
    totalCostUsd: 0.2,
    triage: { decision: "appeal", reason: "ev clears", would_have_been_worked_old: true } as never,
    classify: {
      category: "medical_necessity",
      root_cause: "severity_not_documented",
      key_facts: [],
      confidence: 0.9,
    },
    retrieval: {
      query: "q",
      clauses: [
        { id: "C1", code: "A", text: "t", required: true, score: 1, forced: false },
        { id: "C2", code: "B", text: "t", required: true, score: 1, forced: false },
        { id: "C9", code: "Z", text: "t", required: false, score: 1, forced: false },
      ],
      precedents: [{ id: "P1", summary: "s", letterExcerpt: "e", outcome: "overturned", score: 1 }],
      requiredClauseIds: ["C1", "C2"],
      embeddingTokens: 10,
      costUsd: 0.001,
    },
    draft: {
      sections: [
        {
          name: "criteria_argument",
          assertions: [
            { text: "a", chart_line_ids: ["L1"], clause_ids: ["C1"] },
            { text: "b", chart_line_ids: ["L2"], clause_ids: ["C2"] },
          ],
        },
      ],
      unsupported_required: [],
      draft_confidence: 0.9,
    } as never,
    letterText: "letter",
    verification: {
      citation: { validityRate: 1, totalCitations: 4, invalidChartLineIds: [], invalidClauseIds: [] },
      coverage: { coverage: 1, coveredRequiredClauseIds: ["C1", "C2"], uncoveredRequiredClauseIds: [] },
      judge: {
        faithfulness: 0.95,
        completeness: 0.9,
        tone: 0.95,
        overall: 0.92,
        flagged_assertions: [],
      },
      decision: { route: "ready", route_reason: "clean", composite: 0.9 },
      usage: { tokensIn: 100, tokensOut: 50, cacheReadTokens: 0, costUsd: 0.05 },
    },
    ...overrides,
  };
}

describe("gradeCase", () => {
  it("marks an exact category and root-cause match correct", () => {
    const g = gradeCase(truth(), result());
    expect(g.grades.categoryCorrect).toBe(true);
    expect(g.grades.rootCauseCorrect).toBe(true);
  });

  it("marks a category mismatch incorrect", () => {
    const r = result();
    r.classify = { ...r.classify!, category: "level_of_care" };
    expect(gradeCase(truth(), r).grades.categoryCorrect).toBe(false);
  });

  it("computes clause recall over the labeled met clauses", () => {
    // Labels C1 to C4 as met; retrieval returned C1, C2 and an unrelated C9.
    expect(gradeCase(truth(), result()).grades.clauseRecall).toBe(0.5);
  });

  it("returns null clause recall when the label lists no met clauses", () => {
    expect(gradeCase(truth({ metClauseIds: [] }), result()).grades.clauseRecall).toBeNull();
  });

  it("counts a precedent hit only when the searched category was right", () => {
    expect(gradeCase(truth(), result()).grades.precedentHit).toBe(true);
    const wrong = result();
    wrong.classify = { ...wrong.classify!, category: "level_of_care" };
    expect(gradeCase(truth(), wrong).grades.precedentHit).toBe(false);
  });

  it("counts no precedents as a miss", () => {
    const r = result();
    r.retrieval = { ...r.retrieval!, precedents: [] };
    expect(gradeCase(truth(), r).grades.precedentHit).toBe(false);
  });

  it("agrees with the human label when a high judge score meets approve_as_is", () => {
    expect(gradeCase(truth({ approveAsIs: true }), result()).grades.judgeAgrees).toBe(true);
  });

  it("disagrees when a high judge score meets a do-not-approve label", () => {
    expect(gradeCase(truth({ approveAsIs: false }), result()).grades.judgeAgrees).toBe(false);
  });

  it("treats a judge score under the threshold as not approve-as-is", () => {
    const r = result();
    r.verification = { ...r.verification!, judge: { ...r.verification!.judge!, overall: 0.7 } };
    expect(gradeCase(truth({ approveAsIs: false }), r).grades.judgeAgrees).toBe(true);
  });

  it("flags a false write-off only on a winnable case", () => {
    const writeOff = result({ route: "do_not_appeal" });
    expect(gradeCase(truth({ winnable: true }), writeOff).grades.falseWriteOff).toBe(true);
    expect(gradeCase(truth({ winnable: false }), writeOff).grades.falseWriteOff).toBe(false);
  });

  it("does not call a correct decline a false write-off", () => {
    // Winnable means the clinical argument holds. A case can be arguable and
    // still be one triage should decline on economics, and declining it is
    // the right answer, not an error.
    const declined = truth({ winnable: true, expectedRoute: "do_not_appeal" });
    expect(gradeCase(declined, result({ route: "do_not_appeal" })).grades.falseWriteOff).toBe(false);
  });

  it("leaves classify grades null when triage stopped the run", () => {
    const stopped = result({ route: "do_not_appeal", classify: null, retrieval: null, draft: null, verification: null });
    const g = gradeCase(truth(), stopped);
    expect(g.grades.categoryCorrect).toBeNull();
    expect(g.grades.precedentHit).toBeNull();
    expect(g.grades.judgeAgrees).toBeNull();
  });

  it("recovers the valid citation count from the rate and the total", () => {
    const r = result();
    r.verification = {
      ...r.verification!,
      citation: { validityRate: 0.75, totalCitations: 8, invalidChartLineIds: ["L9"], invalidClauseIds: [] },
    };
    expect(gradeCase(truth(), r).actual.citationsValid).toBe(6);
  });
});

describe("inFalseWriteOffScope", () => {
  it("includes a winnable case the label says to work", () => {
    expect(inFalseWriteOffScope({ winnable: true, expectedRoute: "ready" })).toBe(true);
    expect(inFalseWriteOffScope({ winnable: true, expectedRoute: "needs_review" })).toBe(true);
  });

  it("excludes a case the label expects to be declined", () => {
    expect(inFalseWriteOffScope({ winnable: true, expectedRoute: "do_not_appeal" })).toBe(false);
  });

  it("excludes a case that is not winnable", () => {
    expect(inFalseWriteOffScope({ winnable: false, expectedRoute: "ready" })).toBe(false);
  });
});

describe("isFalseWriteOff", () => {
  it("is true only for a decline on an in-scope case", () => {
    expect(isFalseWriteOff({ winnable: true, expectedRoute: "ready" }, "do_not_appeal")).toBe(true);
  });

  it("is false when the pipeline worked the case", () => {
    expect(isFalseWriteOff({ winnable: true, expectedRoute: "ready" }, "needs_review")).toBe(false);
  });

  it("is false for a correct decline", () => {
    expect(isFalseWriteOff({ winnable: true, expectedRoute: "do_not_appeal" }, "do_not_appeal")).toBe(false);
  });

  it("is false when the run crashed and produced no route", () => {
    expect(isFalseWriteOff({ winnable: true, expectedRoute: "ready" }, null)).toBe(false);
  });
});

describe("failedCase", () => {
  it("counts a crashed run as a route miss", () => {
    const g = failedCase(truth(), "boom");
    expect(g.status).toBe("failed");
    expect(g.grades.routeCorrect).toBe(false);
    expect(g.error).toBe("boom");
  });

  it("does not count a crash as a false write-off", () => {
    expect(failedCase(truth(), "boom").grades.falseWriteOff).toBe(false);
  });
});

describe("percentile", () => {
  it("returns zero for an empty set", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the only value for a single sample", () => {
    expect(percentile([7], 0.9)).toBe(7);
  });

  it("takes the midpoint of an even set", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("interpolates like percentile_cont", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46, 10);
  });

  it("does not care about input order", () => {
    expect(percentile([50, 10, 30, 20, 40], 0.5)).toBe(30);
  });
});

describe("aggregate", () => {
  const grade = (overrides: Partial<CaseGrade["grades"]>, actual: Partial<CaseGrade["actual"]> = {}) => {
    const base = gradeCase(truth(), result());
    return { ...base, grades: { ...base.grades, ...overrides }, actual: { ...base.actual, ...actual } };
  };

  it("produces metrics that satisfy the dashboard contract", () => {
    const metrics = aggregate([grade({})], { ruleTests: { n: 5, of: 5 }, reviewerAgreement: null });
    expect(evalMetricsSchema.safeParse(metrics).success).toBe(true);
  });

  it("counts route accuracy over every case including failures", () => {
    const metrics = aggregate([grade({ routeCorrect: true }), failedCase(truth(), "boom")], {
      ruleTests: null,
      reviewerAgreement: null,
    });
    expect(metrics.e.routeAccuracy).toEqual({ n: 1, of: 2 });
  });

  it("excludes failed runs from the classify denominator", () => {
    const metrics = aggregate([grade({ categoryCorrect: true }), failedCase(truth(), "boom")], {
      ruleTests: null,
      reviewerAgreement: null,
    });
    expect(metrics.b.categoryAccuracy).toEqual({ n: 1, of: 1 });
  });

  it("pools citations across cases rather than averaging rates", () => {
    const metrics = aggregate(
      [
        grade({}, { citationsValid: 1, citationsTotal: 2 }),
        grade({}, { citationsValid: 98, citationsTotal: 98 }),
      ],
      { ruleTests: null, reviewerAgreement: null },
    );
    // Averaging the rates would read 75%; pooling reads the true 99 of 100.
    expect(metrics.d.citationValidity).toEqual({ n: 99, of: 100 });
  });

  it("separates mean confidence on correct and incorrect classifications", () => {
    const metrics = aggregate(
      [
        grade({ categoryCorrect: true }, { classifyConfidence: 0.9 }),
        grade({ categoryCorrect: true }, { classifyConfidence: 0.8 }),
        grade({ categoryCorrect: false }, { classifyConfidence: 0.5 }),
      ],
      { ruleTests: null, reviewerAgreement: null },
    );
    expect(metrics.b.confidenceCorrect).toEqual({ value: 0.8500000000000001, n: 2 });
    expect(metrics.b.confidenceIncorrect).toEqual({ value: 0.5, n: 1 });
  });

  it("reports null confidence buckets when a side is empty", () => {
    const metrics = aggregate([grade({ categoryCorrect: true })], {
      ruleTests: null,
      reviewerAgreement: null,
    });
    expect(metrics.b.confidenceIncorrect).toBeNull();
  });

  it("averages clause recall only over cases that had labeled clauses", () => {
    const metrics = aggregate([grade({ clauseRecall: 1 }), grade({ clauseRecall: null })], {
      ruleTests: null,
      reviewerAgreement: null,
    });
    expect(metrics.c.clauseRecallAt8).toEqual({ value: 1, n: 1 });
  });

  it("counts false write-offs against winnable cases only", () => {
    const metrics = aggregate(
      [
        { ...grade({ falseWriteOff: true }), expected: { ...grade({}).expected, winnable: true } },
        { ...grade({ falseWriteOff: false }), expected: { ...grade({}).expected, winnable: false } },
      ],
      { ruleTests: null, reviewerAgreement: null },
    );
    expect(metrics.a.falseWriteOff).toEqual({ n: 1, of: 1 });
  });

  it("keeps cases the label expects to be declined out of the fraction", () => {
    const base = grade({});
    const declined = {
      ...base,
      expected: { ...base.expected, winnable: true, route: "do_not_appeal" },
      grades: { ...base.grades, falseWriteOff: false },
    };
    const metrics = aggregate([grade({ falseWriteOff: false }), declined, declined], {
      ruleTests: null,
      reviewerAgreement: null,
    });
    // Only the one workable case is in scope; the two correct declines are in
    // neither half of the fraction.
    expect(metrics.a.falseWriteOff).toEqual({ n: 0, of: 1 });
  });

  it("derives faithfulness from unflagged assertions", () => {
    const metrics = aggregate(
      [grade({}, { assertions: 10, flagged: 2 }), grade({}, { assertions: 10, flagged: 0 })],
      { ruleTests: null, reviewerAgreement: null },
    );
    expect(metrics.d.faithfulness).toEqual({ n: 18, of: 20 });
  });

  it("records latency and cost percentiles over completed cases", () => {
    const metrics = aggregate(
      [
        grade({}, { totalMs: 10000, totalCostUsd: 0.1 }),
        grade({}, { totalMs: 20000, totalCostUsd: 0.2 }),
        grade({}, { totalMs: 30000, totalCostUsd: 0.3 }),
      ],
      { ruleTests: null, reviewerAgreement: null },
    );
    expect(metrics.e2e.pipelineMsMedian).toBe(20000);
    expect(metrics.e2e.costUsdMedian).toBeCloseTo(0.2, 10);
  });

  it("counts errors and completion", () => {
    const metrics = aggregate([grade({}), failedCase(truth(), "boom")], {
      ruleTests: null,
      reviewerAgreement: null,
    });
    expect(metrics.e2e.completed).toEqual({ n: 1, of: 2 });
    expect(metrics.e2e.errors).toBe(1);
  });

  it("passes the rule-test counts straight through", () => {
    const metrics = aggregate([grade({})], { ruleTests: { n: 396, of: 396 }, reviewerAgreement: null });
    expect(metrics.a.ruleTests).toEqual({ n: 396, of: 396 });
  });

  it("survives a split where every run failed", () => {
    const metrics = aggregate([failedCase(truth(), "boom")], { ruleTests: null, reviewerAgreement: null });
    expect(evalMetricsSchema.safeParse(metrics).success).toBe(true);
    expect(metrics.e2e.completed).toEqual({ n: 0, of: 1 });
    expect(metrics.b.categoryAccuracy).toEqual({ n: 0, of: 0 });
  });
});
