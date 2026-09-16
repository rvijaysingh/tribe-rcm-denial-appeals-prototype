import { describe, expect, it } from "vitest";
import { READY_THRESHOLD, REVIEW_THRESHOLD } from "../../src/lib/economics";
import type { Draft } from "../../src/lib/pipeline/draft-schema";
import {
  checkCitations,
  checkCoverage,
  checkJudge,
  decideRoute,
  type JudgeOutput,
  type RouteInput,
} from "../../src/lib/pipeline/e-verify";

const draftWith = (sections: Draft["sections"], unsupported: Draft["unsupported_required"] = []): Draft => ({
  sections,
  unsupported_required: unsupported,
  draft_confidence: 0.9,
});

const lines = new Set([1, 10, 11, 47]);
const clauses = new Set(["C1", "C2", "C65"]);

describe("checkCitations", () => {
  it("is 1.0 when every citation exists", () => {
    const draft = draftWith([
      { name: "criteria_argument", assertions: [{ text: "x", chart_line_ids: ["L10"], clause_ids: ["C1"] }] },
    ]);
    const result = checkCitations(draft, lines, clauses);
    expect(result.validityRate).toBe(1);
    expect(result.totalCitations).toBe(2);
  });

  it("counts a chart line that does not exist as invalid", () => {
    const draft = draftWith([
      { name: "criteria_argument", assertions: [{ text: "x", chart_line_ids: ["L10", "L999"], clause_ids: ["C1"] }] },
    ]);
    const result = checkCitations(draft, lines, clauses);
    expect(result.validityRate).toBeCloseTo(2 / 3);
    expect(result.invalidChartLineIds).toEqual(["L999"]);
  });

  it("counts a clause stage C did not retrieve as invalid", () => {
    const draft = draftWith([
      { name: "criteria_argument", assertions: [{ text: "x", chart_line_ids: ["L10"], clause_ids: ["C99"] }] },
    ]);
    expect(checkCitations(draft, lines, clauses).invalidClauseIds).toEqual(["C99"]);
  });

  it("counts a malformed label as invalid rather than throwing", () => {
    const draft = draftWith([
      { name: "clinical_summary", assertions: [{ text: "x", chart_line_ids: ["line 10"], clause_ids: [] }] },
    ]);
    const result = checkCitations(draft, lines, clauses);
    expect(result.validityRate).toBe(0);
    expect(result.invalidChartLineIds).toEqual(["line 10"]);
  });

  it("reports each distinct invalid ID once", () => {
    const draft = draftWith([
      {
        name: "clinical_summary",
        assertions: [
          { text: "a", chart_line_ids: ["L999"], clause_ids: [] },
          { text: "b", chart_line_ids: ["L999"], clause_ids: [] },
        ],
      },
    ]);
    const result = checkCitations(draft, lines, clauses);
    expect(result.invalidChartLineIds).toEqual(["L999"]);
    expect(result.totalCitations).toBe(2);
  });

  it("is 1.0 for a draft that cites nothing", () => {
    const draft = draftWith([{ name: "intro", assertions: [{ text: "x", chart_line_ids: [], clause_ids: [] }] }]);
    expect(checkCitations(draft, lines, clauses)).toMatchObject({ validityRate: 1, totalCitations: 0 });
  });
});

describe("checkCoverage", () => {
  const draft = draftWith([
    {
      name: "criteria_argument",
      assertions: [
        { text: "a", chart_line_ids: ["L10"], clause_ids: ["C1"] },
        { text: "b", chart_line_ids: ["L11"], clause_ids: ["C2"] },
      ],
    },
  ]);

  it("is 1.0 when every required clause is argued", () => {
    expect(checkCoverage(draft, ["C1", "C2"]).coverage).toBe(1);
  });

  it("reports the required clauses no assertion cites", () => {
    const result = checkCoverage(draft, ["C1", "C2", "C65"]);
    expect(result.coverage).toBeCloseTo(2 / 3);
    expect(result.uncoveredRequiredClauseIds).toEqual(["C65"]);
    expect(result.coveredRequiredClauseIds).toEqual(["C1", "C2"]);
  });

  it("ignores non-required clauses the draft also cites", () => {
    expect(checkCoverage(draft, ["C1"]).coverage).toBe(1);
  });

  it("is 1.0 when the payer set has no required clauses", () => {
    expect(checkCoverage(draft, []).coverage).toBe(1);
  });

  it("counts a clause cited anywhere, not only in criteria_argument", () => {
    const elsewhere = draftWith([
      { name: "precedent", assertions: [{ text: "a", chart_line_ids: ["L10"], clause_ids: ["C65"] }] },
    ]);
    expect(checkCoverage(elsewhere, ["C65"]).coverage).toBe(1);
  });
});

describe("checkJudge", () => {
  const sound: JudgeOutput = {
    faithfulness: 0.9,
    completeness: 0.9,
    tone: 0.95,
    overall: 0.9,
    flagged_assertions: [],
  };

  it("accepts a sound judgement with nothing flagged", () => {
    expect(checkJudge(sound)).toBeNull();
  });

  it.each(["faithfulness", "completeness", "tone", "overall"] as const)("rejects %s out of range", (field) => {
    expect(checkJudge({ ...sound, [field]: 1.4 })).toMatch(new RegExp(field));
  });

  it("rejects more than three flags", () => {
    const flags = Array(4).fill({ assertion_text: "a", reason: "b" });
    expect(checkJudge({ ...sound, flagged_assertions: flags })).toMatch(/at most 3/);
  });

  it("accepts exactly three flags", () => {
    const flags = Array(3).fill({ assertion_text: "a", reason: "b" });
    expect(checkJudge({ ...sound, flagged_assertions: flags })).toBeNull();
  });

  it("rejects a flag with no reason", () => {
    expect(checkJudge({ ...sound, flagged_assertions: [{ assertion_text: "a", reason: " " }] })).toMatch(/no reason/);
  });
});

describe("decideRoute", () => {
  const clean: RouteInput = {
    hasUnsupportedRequired: false,
    classifyConfidence: 0.95,
    draftConfidence: 0.92,
    judgeOverall: 0.9,
    validityRate: 1,
    flaggedCount: 0,
  };

  it("routes ready when confidence is high, citations check out, and nothing is flagged", () => {
    const decision = decideRoute(clean);
    expect(decision.route).toBe("ready");
    expect(decision.composite).toBeCloseTo(0.9);
  });

  it("routes needs_docs when a required criterion is unsupported, before anything else", () => {
    const decision = decideRoute({ ...clean, hasUnsupportedRequired: true });
    expect(decision.route).toBe("needs_docs");
    expect(decision.composite).toBeNull();
  });

  it("prefers needs_docs even when confidence is high and citations are clean", () => {
    expect(decideRoute({ ...clean, hasUnsupportedRequired: true, judgeOverall: 1 }).route).toBe("needs_docs");
  });

  it("takes the composite as the minimum of the three confidences", () => {
    expect(decideRoute({ ...clean, classifyConfidence: 0.7 }).composite).toBeCloseTo(0.7);
    expect(decideRoute({ ...clean, draftConfidence: 0.65 }).composite).toBeCloseTo(0.65);
    expect(decideRoute({ ...clean, judgeOverall: 0.5 }).composite).toBeCloseTo(0.5);
  });

  it("routes ready exactly at the ready threshold", () => {
    const decision = decideRoute({ ...clean, judgeOverall: READY_THRESHOLD, draftConfidence: 0.9, classifyConfidence: 0.9 });
    expect(decision.route).toBe("ready");
  });

  it("routes needs_review just below the ready threshold", () => {
    const decision = decideRoute({ ...clean, judgeOverall: READY_THRESHOLD - 0.01 });
    expect(decision.route).toBe("needs_review");
    expect(decision.route_reason).toMatch(/confidence 0\.84 is under 0\.85/);
  });

  it("routes needs_review on any flagged assertion even at perfect confidence", () => {
    const decision = decideRoute({ ...clean, classifyConfidence: 1, draftConfidence: 1, judgeOverall: 1, flaggedCount: 1 });
    expect(decision.route).toBe("needs_review");
    expect(decision.route_reason).toMatch(/flagged 1 assertion/);
  });

  it("routes needs_review on imperfect citation validity even at perfect confidence", () => {
    const decision = decideRoute({ ...clean, classifyConfidence: 1, draftConfidence: 1, judgeOverall: 1, validityRate: 0.95 });
    expect(decision.route).toBe("needs_review");
    expect(decision.route_reason).toMatch(/citation validity 95% is under 100%/);
  });

  it("routes needs_review below the review threshold, and says to read it in full", () => {
    // The PRD names no route under 0.60; needs_review is the only sensible home.
    const decision = decideRoute({ ...clean, judgeOverall: REVIEW_THRESHOLD - 0.1 });
    expect(decision.route).toBe("needs_review");
    expect(decision.route_reason).toMatch(/below the review threshold/);
  });

  it("does not add the below-threshold note when the composite is inside the review band", () => {
    const decision = decideRoute({ ...clean, judgeOverall: 0.7 });
    expect(decision.route_reason).not.toMatch(/below the review threshold/);
  });

  it("lists every reason it did not route ready", () => {
    const decision = decideRoute({ ...clean, judgeOverall: 0.5, validityRate: 0.8, flaggedCount: 2 });
    expect(decision.route_reason).toMatch(/confidence/);
    expect(decision.route_reason).toMatch(/citation validity/);
    expect(decision.route_reason).toMatch(/flagged 2 assertion/);
  });
});
