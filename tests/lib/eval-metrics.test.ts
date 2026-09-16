import { describe, expect, it } from "vitest";
import {
  deltaAgainst,
  EVAL_GROUPS,
  formatMetric,
  HISTORY_KEYS,
  METRIC_SPECS,
  readEvalMetrics,
  specByKey,
  pickBaseline,
  specsFor,
  type EvalMetrics,
} from "../../src/lib/eval/metrics";

function metrics(overrides: Partial<EvalMetrics> = {}): EvalMetrics {
  return {
    a: { falseWriteOff: { n: 0, of: 14 }, ruleTests: { n: 369, of: 369 } },
    b: {
      categoryAccuracy: { n: 19, of: 20 },
      rootCauseAccuracy: { n: 17, of: 20 },
      confidenceCorrect: { value: 0.91, n: 19 },
      confidenceIncorrect: { value: 0.68, n: 1 },
    },
    c: { clauseRecallAt8: { value: 0.91, n: 20 }, precedentRecallAt3: { n: 17, of: 20 } },
    d: {
      citationValidity: { n: 331, of: 343 },
      criteriaCoverage: { n: 106, of: 120 },
      faithfulness: { n: 88, of: 100 },
    },
    e: { routeAccuracy: { n: 18, of: 20 }, judgeAgreement: { n: 16, of: 20 } },
    e2e: {
      pipelineMsMedian: 41200,
      pipelineMsP90: 78500,
      costUsdMedian: 0.21,
      costUsdP90: 0.38,
      reviewerAgreement: { n: 3, of: 4 },
      completed: { n: 20, of: 20 },
      errors: 0,
    },
    ...overrides,
  };
}

describe("evalMetricsSchema", () => {
  it("accepts a complete metrics object", () => {
    expect(readEvalMetrics(metrics())).not.toBeNull();
  });

  it("returns null rather than a partial reading when a stage is missing", () => {
    const partial = metrics() as Record<string, unknown>;
    delete partial.d;
    expect(readEvalMetrics(partial)).toBeNull();
  });

  it("returns null for a run written before the contract existed", () => {
    expect(readEvalMetrics({ category_accuracy: 0.95 })).toBeNull();
  });

  it("returns null for junk", () => {
    expect(readEvalMetrics(null)).toBeNull();
    expect(readEvalMetrics("{}")).toBeNull();
  });

  it("allows the nullable fields to be null", () => {
    const m = metrics();
    m.a.ruleTests = null;
    m.b.confidenceIncorrect = null;
    m.e2e.reviewerAgreement = null;
    expect(readEvalMetrics(m)).not.toBeNull();
  });
});

describe("metric specs", () => {
  it("covers every metric in PRD 9.2", () => {
    // 15 rows in the table, with confidence calibration as one card.
    expect(METRIC_SPECS).toHaveLength(16);
  });

  it("assigns every spec to a declared group", () => {
    const keys = new Set(EVAL_GROUPS.map((g) => g.key));
    for (const spec of METRIC_SPECS) expect(keys.has(spec.group)).toBe(true);
  });

  it("gives every group at least one metric", () => {
    for (const group of EVAL_GROUPS) expect(specsFor(group.key).length).toBeGreaterThan(0);
  });

  it("uses unique keys", () => {
    expect(new Set(METRIC_SPECS.map((s) => s.key)).size).toBe(METRIC_SPECS.length);
  });

  it("resolves every history column to a spec", () => {
    for (const key of HISTORY_KEYS) expect(specByKey(key)).toBeDefined();
  });
});

describe("formatMetric", () => {
  const m = metrics();
  const fmt = (key: string) => formatMetric(specByKey(key)!, m);

  it("formats a ratio as a percentage", () => {
    expect(fmt("categoryAccuracy")).toBe("95.0%");
  });

  it("formats a mean to two decimals", () => {
    expect(fmt("clauseRecallAt8")).toBe("0.91");
  });

  it("formats milliseconds as seconds", () => {
    expect(fmt("pipelineSeconds")).toBe("41.2s");
  });

  it("formats cost in dollars and cents", () => {
    expect(fmt("costPerCase")).toBe("$0.21");
  });

  it("shows the confidence gap as two numbers, not one score", () => {
    expect(fmt("confidence")).toBe("0.91 / 0.68");
  });

  it("shows a dash when a nullable metric was not collected", () => {
    const without = metrics();
    without.a.ruleTests = null;
    expect(formatMetric(specByKey("ruleTests")!, without)).toBe("—");
  });

  it("shows a dash rather than NaN when the denominator is zero", () => {
    const empty = metrics();
    empty.e.routeAccuracy = { n: 0, of: 0 };
    expect(formatMetric(specByKey("routeAccuracy")!, empty)).toBe("—");
  });

  it("carries the count alongside the percentage", () => {
    expect(specByKey("citationValidity")!.read(m).note).toBe("331 / 343 ids");
  });
});

describe("deltaAgainst", () => {
  const spec = (key: string) => specByKey(key)!;

  it("reports no comparison when there is no baseline", () => {
    expect(deltaAgainst(spec("routeAccuracy"), metrics(), null)).toEqual({ tone: "none", text: "" });
  });

  it("calls a rise in an up metric better", () => {
    const before = metrics();
    before.e.routeAccuracy = { n: 16, of: 20 };
    const result = deltaAgainst(spec("routeAccuracy"), metrics(), before);
    expect(result).toEqual({ tone: "better", text: "+10.0 pts" });
  });

  it("calls a fall in an up metric worse", () => {
    const before = metrics();
    before.e.routeAccuracy = { n: 20, of: 20 };
    const result = deltaAgainst(spec("routeAccuracy"), metrics(), before);
    expect(result.tone).toBe("worse");
    expect(result.text).toBe("−10.0 pts");
  });

  it("calls a fall in a down metric better", () => {
    const before = metrics();
    before.e2e.costUsdMedian = 0.3;
    expect(deltaAgainst(spec("costPerCase"), metrics(), before)).toEqual({
      tone: "better",
      text: "−$0.09",
    });
  });

  it("calls a rise in a down metric worse", () => {
    const before = metrics();
    before.a.falseWriteOff = { n: 0, of: 14 };
    const now = metrics();
    now.a.falseWriteOff = { n: 2, of: 14 };
    expect(deltaAgainst(spec("falseWriteOff"), now, before).tone).toBe("worse");
  });

  it("calls an identical run flat", () => {
    expect(deltaAgainst(spec("citationValidity"), metrics(), metrics())).toEqual({
      tone: "flat",
      text: "no change",
    });
  });

  it("does not put a direction on confidence calibration", () => {
    expect(deltaAgainst(spec("confidence"), metrics(), metrics()).tone).toBe("none");
  });

  it("skips the comparison when either side is missing the metric", () => {
    const before = metrics();
    before.a.ruleTests = null;
    expect(deltaAgainst(spec("ruleTests"), metrics(), before)).toEqual({ tone: "none", text: "" });
  });

  it("reports seconds deltas in seconds", () => {
    const before = metrics();
    before.e2e.pipelineMsMedian = 43800;
    expect(deltaAgainst(spec("pipelineSeconds"), metrics(), before)).toEqual({
      tone: "better",
      text: "−2.6s",
    });
  });
});

describe("pickBaseline", () => {
  const run = (id: string, reference = false) => ({ id, reference });

  it("returns null when there are no runs", () => {
    expect(pickBaseline([])).toBeNull();
  });

  it("returns null when the only run is the latest", () => {
    expect(pickBaseline([run("er-0002")])).toBeNull();
  });

  it("prefers the reference run over the previous run", () => {
    const runs = [run("er-0003"), run("er-0002"), run("er-0001", true)];
    expect(pickBaseline(runs)?.id).toBe("er-0001");
  });

  it("falls back to the previous run before a reference exists", () => {
    // PRD 9.3 marks the reference run late, so most of the project runs
    // without one. A real previous run beats showing no delta at all.
    const runs = [run("er-0002"), run("er-0001")];
    expect(pickBaseline(runs)?.id).toBe("er-0001");
  });

  it("compares the reference run against the run before it", () => {
    const runs = [run("er-0003", true), run("er-0002"), run("er-0001")];
    expect(pickBaseline(runs)?.id).toBe("er-0002");
  });

  it("never compares a run against itself", () => {
    const runs = [run("er-0002", true), run("er-0001")];
    expect(pickBaseline(runs)?.id).toBe("er-0001");
  });
});
