import { describe, expect, it } from "vitest";
import { buildQuery, formatChartForPrompt, mergeForcedRequired } from "../../src/lib/pipeline/c-retrieve";

const clause = (id: string, code: string, required: boolean, score: number) => ({
  id,
  code,
  text: `text for ${code}`,
  required,
  score,
});

describe("buildQuery", () => {
  it("puts the payer's argument first, then the facts", () => {
    expect(buildQuery("severity_not_documented", ["Saturation was normal.", "No oxygen needed."])).toBe(
      "severity not documented. Saturation was normal. No oxygen needed.",
    );
  });

  it("does not double-punctuate facts that already end in a period", () => {
    expect(buildQuery("severity_not_documented", ["Already punctuated."])).not.toContain("..");
  });

  it("drops blank facts", () => {
    expect(buildQuery("los_exceeds_expected", ["  ", "Only fact."])).toBe("los exceeds expected. Only fact.");
  });

  it("works with no facts at all", () => {
    expect(buildQuery("criteria_not_met_at_admission", [])).toBe("criteria not met at admission.");
  });
});

describe("mergeForcedRequired", () => {
  it("keeps the top ranked clauses in rank order", () => {
    const ranked = [clause("C1", "SEP-01", false, 0.9), clause("C2", "SEP-02", false, 0.8)];
    expect(mergeForcedRequired(ranked, 8).map((c) => c.id)).toEqual(["C1", "C2"]);
  });

  it("marks ranked clauses as not forced", () => {
    expect(mergeForcedRequired([clause("C1", "SEP-01", true, 0.9)], 8)[0].forced).toBe(false);
  });

  it("adds a required clause that missed the cut, marked forced", () => {
    const ranked = [
      clause("C1", "SEP-01", false, 0.9),
      clause("C2", "SEP-02", false, 0.8),
      clause("C9", "SEP-09", true, 0.1),
    ];
    const merged = mergeForcedRequired(ranked, 2);
    expect(merged.map((c) => c.id)).toEqual(["C1", "C2", "C9"]);
    expect(merged.map((c) => c.forced)).toEqual([false, false, true]);
  });

  it("does not duplicate a required clause that already ranked", () => {
    const ranked = [clause("C1", "SEP-01", true, 0.9), clause("C2", "SEP-02", false, 0.8)];
    const merged = mergeForcedRequired(ranked, 8);
    expect(merged.filter((c) => c.id === "C1")).toHaveLength(1);
    expect(merged[0].forced).toBe(false);
  });

  it("orders several forced clauses by code", () => {
    const ranked = [
      clause("C1", "SEP-01", false, 0.9),
      clause("C7", "SEP-07", true, 0.2),
      clause("C3", "SEP-03", true, 0.1),
    ];
    expect(mergeForcedRequired(ranked, 1).map((c) => c.code)).toEqual(["SEP-01", "SEP-03", "SEP-07"]);
  });

  it("can return more than the limit when required clauses rank low", () => {
    const ranked = [
      clause("C1", "SEP-01", false, 0.9),
      clause("C2", "SEP-02", true, 0.2),
      clause("C3", "SEP-03", true, 0.1),
    ];
    expect(mergeForcedRequired(ranked, 1)).toHaveLength(3);
  });

  it("returns an empty list for an empty set", () => {
    expect(mergeForcedRequired([], 8)).toEqual([]);
  });
});

describe("formatChartForPrompt", () => {
  it("labels each line with the citation label the model must use", () => {
    expect(formatChartForPrompt([{ lineNo: 1, text: "HPI:" }, { lineNo: 47, text: "SpO2 86% on RA." }])).toBe(
      "L1: HPI:\nL47: SpO2 86% on RA.",
    );
  });

  it("is empty for an empty chart", () => {
    expect(formatChartForPrompt([])).toBe("");
  });
});
