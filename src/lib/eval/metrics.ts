/**
 * The eval metric contract: every metric in PRD 9.2, in the shape the M4
 * harness writes to EvalRun.metricsJson and the eval dashboard reads back.
 *
 * Both sides import this file so neither has to guess the other's key names.
 * The harness is not built yet (M4); until it runs, the dashboard shows an
 * empty state rather than placeholder numbers.
 *
 * Counted metrics are stored as {n, of} rather than a pre-divided float so the
 * dashboard can show "19 / 20" under "95.0%" without a second source, and so a
 * denominator of zero is visible instead of arriving as NaN.
 */

import { z } from "zod";

const ratio = z.object({ n: z.number(), of: z.number() });
/** A mean over cases, with the case count it was taken over. */
const mean = z.object({ value: z.number(), n: z.number() });

export const evalMetricsSchema = z.object({
  a: z.object({
    /**
     * Do-not-appeal decisions on cases the label says should have been worked,
     * over all such cases. A correct decline is in neither half (PRD 9.2).
     */
    falseWriteOff: ratio,
    /** Unit test pass rate. Null when the harness ran without the suite. */
    ruleTests: ratio.nullable(),
  }),
  b: z.object({
    categoryAccuracy: ratio,
    rootCauseAccuracy: ratio,
    /** Calibration is the gap between these two, not a single score. */
    confidenceCorrect: mean.nullable(),
    confidenceIncorrect: mean.nullable(),
  }),
  c: z.object({
    /** Mean over cases of labeled met_clause_ids present in the retrieved set. */
    clauseRecallAt8: mean,
    /** Cases with at least one overturned precedent of the same category. */
    precedentRecallAt3: ratio,
  }),
  d: z.object({
    citationValidity: ratio,
    criteriaCoverage: ratio,
    /** Judge-scored assertions whose cited lines support them / all assertions. */
    faithfulness: ratio,
  }),
  e: z.object({
    routeAccuracy: ratio,
    /** Judge overall at or above 0.85 matching the human approve_as_is label. */
    judgeAgreement: ratio,
  }),
  e2e: z.object({
    pipelineMsMedian: z.number(),
    pipelineMsP90: z.number(),
    costUsdMedian: z.number(),
    costUsdP90: z.number(),
    /** From ReviewerFeedback. Null when no run in the set was reviewed. */
    reviewerAgreement: ratio.nullable(),
    completed: ratio,
    errors: z.number(),
  }),
});

export type EvalMetrics = z.infer<typeof evalMetricsSchema>;

/**
 * Parse metricsJson off an EvalRun row. Returns null on a shape mismatch so
 * the dashboard can say the run is unreadable instead of rendering NaN.
 */
export function readEvalMetrics(json: unknown): EvalMetrics | null {
  const parsed = evalMetricsSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface EvalGroup {
  key: string;
  name: string;
  kind: "RULES" | "LLM" | "PIPELINE";
}

export const EVAL_GROUPS: EvalGroup[] = [
  { key: "A", name: "Triage", kind: "RULES" },
  { key: "B", name: "Classify", kind: "LLM" },
  { key: "C", name: "Retrieve", kind: "RULES" },
  { key: "D", name: "Draft", kind: "LLM" },
  { key: "E", name: "Verify", kind: "LLM" },
  { key: "∑", name: "End to end", kind: "PIPELINE" },
];

/** Higher is better, lower is better, or neither (a diagnostic reading). */
export type Direction = "up" | "down" | "none";

export interface MetricSpec {
  key: string;
  group: string;
  /** Card label. */
  label: string;
  /**
   * One line of plain English, for a reader who knows denials but not evals.
   * Shown under the metric rather than in a tooltip: a panellist should not
   * have to hover to find out what a number means.
   */
  description: string;
  /** History table column header, kept short. */
  short: string;
  direction: Direction;
  format: "percent" | "decimal" | "seconds" | "cost" | "count";
  read: (m: EvalMetrics) => { value: number | null; display?: string; note: string };
}

function pct(r: { n: number; of: number }, unit = ""): { value: number | null; note: string } {
  const note = `${r.n} / ${r.of}${unit ? ` ${unit}` : ""}`;
  return { value: r.of === 0 ? null : r.n / r.of, note };
}

export const METRIC_SPECS: MetricSpec[] = [
  {
    key: "falseWriteOff",
    group: "A",
    label: "False write-off rate",
    description:
      "Winnable denials that triage declined to appeal. 0% means rules left no revenue on the table.",
    short: "False w/o",
    direction: "down",
    format: "percent",
    read: (m) => pct(m.a.falseWriteOff, "workable"),
  },
  {
    key: "ruleTests",
    group: "A",
    label: "Rule test pass rate",
    description:
      "Deterministic triage rules verified by unit tests.",
    short: "Rule tests",
    direction: "up",
    format: "percent",
    read: (m) => (m.a.ruleTests ? pct(m.a.ruleTests) : { value: null, note: "not run with the suite" }),
  },
  {
    key: "categoryAccuracy",
    group: "B",
    label: "Category accuracy",
    description:
      "Denial category (medical necessity vs level of care) matched the label.",
    short: "Cat acc",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.b.categoryAccuracy),
  },
  {
    key: "rootCauseAccuracy",
    group: "B",
    label: "Root-cause accuracy",
    description:
      "The specific criterion the payer cited matched the label.",
    short: "Root cause",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.b.rootCauseAccuracy),
  },
  {
    key: "confidence",
    group: "B",
    label: "Confidence calibration",
    description:
      "Mean confidence on correct vs incorrect classifications. Should be higher on correct.",
    short: "Calibration",
    direction: "none",
    format: "decimal",
    read: (m) => {
      const ok = m.b.confidenceCorrect;
      const bad = m.b.confidenceIncorrect;
      if (!ok) return { value: null, note: "no correct classifications" };
      const right = ok.value.toFixed(2);
      const wrong = bad ? bad.value.toFixed(2) : "—";
      return {
        value: null,
        display: `${right} / ${wrong}`,
        note: bad ? `mean on ${ok.n} correct / ${bad.n} wrong` : "no incorrect classifications",
      };
    },
  },
  {
    key: "clauseRecallAt8",
    group: "C",
    label: "Clause recall@8",
    description:
      "Relevant criteria clauses that appeared in the top 8 retrieved.",
    short: "Clause R@8",
    direction: "up",
    format: "decimal",
    read: (m) => ({ value: m.c.clauseRecallAt8.value, note: `n=${m.c.clauseRecallAt8.n}` }),
  },
  {
    key: "precedentRecallAt3",
    group: "C",
    label: "Precedent recall@3",
    description:
      "A relevant overturned precedent appeared in the top 3 retrieved.",
    short: "Prec R@3",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.c.precedentRecallAt3),
  },
  {
    key: "citationValidity",
    group: "D",
    label: "Citation validity",
    description:
      "Every cited chart line and clause exists. Deterministic check.",
    short: "Cite valid",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.d.citationValidity, "ids"),
  },
  {
    key: "criteriaCoverage",
    group: "D",
    label: "Criteria coverage",
    description:
      "Required clauses with at least one supporting assertion in the draft.",
    short: "Coverage",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.d.criteriaCoverage, "clauses"),
  },
  {
    key: "faithfulness",
    group: "D",
    label: "Faithfulness (judge)",
    description:
      "Assertions whose cited lines actually support them, scored by the judge model.",
    short: "Faithful",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.d.faithfulness, "assertions"),
  },
  {
    key: "routeAccuracy",
    group: "E",
    label: "Route accuracy",
    description:
      "Pipeline route matched the expected route.",
    short: "Route acc",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.e.routeAccuracy),
  },
  {
    key: "judgeAgreement",
    group: "E",
    label: "Judge agreement",
    description:
      "Judge verdict matched the human approve-as-is label.",
    short: "Judge agr",
    direction: "up",
    format: "percent",
    read: (m) => pct(m.e.judgeAgreement),
  },
  {
    key: "pipelineSeconds",
    group: "∑",
    label: "Pipeline seconds (median)",
    description:
      "End-to-end time per case, median and p90.",
    short: "Sec (med)",
    direction: "down",
    format: "seconds",
    read: (m) => ({
      value: m.e2e.pipelineMsMedian / 1000,
      note: `p90 ${(m.e2e.pipelineMsP90 / 1000).toFixed(1)}s`,
    }),
  },
  {
    key: "costPerCase",
    group: "∑",
    label: "Cost per case (median)",
    description:
      "Inference cost from token counts, median.",
    short: "$ (med)",
    direction: "down",
    format: "cost",
    read: (m) => ({
      value: m.e2e.costUsdMedian,
      note: `p90 $${m.e2e.costUsdP90.toFixed(2)}`,
    }),
  },
  {
    key: "reviewerAgreement",
    group: "∑",
    label: "Reviewer agreement",
    description:
      "Drafts approved as-is by the reviewer.",
    short: "Rev agr",
    direction: "up",
    format: "percent",
    read: (m) =>
      m.e2e.reviewerAgreement
        ? pct(m.e2e.reviewerAgreement, "reviewed")
        : { value: null, note: "no reviewed runs in this set" },
  },
  {
    key: "completed",
    group: "∑",
    label: "Cases completed",
    description:
      "Cases that ran to completion without an error.",
    short: "Done",
    direction: "up",
    format: "count",
    read: (m) => ({
      value: m.e2e.completed.n,
      display: `${m.e2e.completed.n} / ${m.e2e.completed.of}`,
      note: m.e2e.errors === 0 ? "0 errors" : `${m.e2e.errors} errors`,
    }),
  },
];

/** Columns the history table shows, in order. */
export const HISTORY_KEYS = [
  "categoryAccuracy",
  "clauseRecallAt8",
  "citationValidity",
  "criteriaCoverage",
  "routeAccuracy",
  "pipelineSeconds",
  "costPerCase",
] as const;

export function specsFor(group: string): MetricSpec[] {
  return METRIC_SPECS.filter((s) => s.group === group);
}

export function specByKey(key: string): MetricSpec | undefined {
  return METRIC_SPECS.find((s) => s.key === key);
}

/** The value as it appears on a card or in a table cell. */
export function formatMetric(spec: MetricSpec, metrics: EvalMetrics): string {
  const { value, display } = spec.read(metrics);
  if (display) return display;
  if (value === null) return "—";
  switch (spec.format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "decimal":
      return value.toFixed(2);
    case "seconds":
      return `${value.toFixed(1)}s`;
    case "cost":
      return `$${value.toFixed(2)}`;
    case "count":
      return String(value);
  }
}

export type DeltaTone = "better" | "worse" | "flat" | "none";

export interface Delta {
  tone: DeltaTone;
  /** Empty when there is nothing to compare against. */
  text: string;
}

/**
 * Change against a baseline run. PRD 9.3 asks for deltas on every prompt
 * change and names the reference run as the thing to compare to, so colour on
 * this dashboard means "moved against the baseline", not "passed a bar". The
 * PRD sets no absolute target for any stage metric and this file invents none.
 */
export function deltaAgainst(
  spec: MetricSpec,
  current: EvalMetrics,
  baseline: EvalMetrics | null,
): Delta {
  if (!baseline || spec.direction === "none") return { tone: "none", text: "" };
  const now = spec.read(current).value;
  const before = spec.read(baseline).value;
  if (now === null || before === null) return { tone: "none", text: "" };

  const raw = now - before;
  const sign = raw > 0 ? "+" : "−";
  const size = Math.abs(raw);

  let text: string;
  let negligible: boolean;
  switch (spec.format) {
    case "percent":
      text = `${sign}${(size * 100).toFixed(1)} pts`;
      negligible = size * 100 < 0.05;
      break;
    case "decimal":
      text = `${sign}${size.toFixed(2)}`;
      negligible = size < 0.005;
      break;
    case "seconds":
      text = `${sign}${size.toFixed(1)}s`;
      negligible = size < 0.05;
      break;
    case "cost":
      text = `${sign}$${size.toFixed(2)}`;
      negligible = size < 0.005;
      break;
    case "count":
      text = `${sign}${size}`;
      negligible = size === 0;
      break;
  }

  if (negligible) return { tone: "flat", text: "no change" };
  const better = spec.direction === "up" ? raw > 0 : raw < 0;
  return { tone: better ? "better" : "worse", text };
}

/**
 * Which run the latest one is compared against.
 *
 * PRD 9.3 names the reference run as the comparison baseline, so it wins when
 * one exists. Before the reference run has been marked, the run immediately
 * before is still a real comparison and is better than showing no delta at
 * all. When the latest run is itself the reference, it compares to the run
 * before it rather than to itself.
 *
 * Takes the newest-first list the dashboard already holds.
 */
export function pickBaseline<T extends { id: string; reference: boolean }>(
  runs: readonly T[],
): T | null {
  const latest = runs[0];
  if (!latest) return null;
  const previous = runs[1] ?? null;
  if (latest.reference) return previous;
  return runs.find((r) => r.reference && r.id !== latest.id) ?? previous;
}

/** PRD 6.5 banner. Says out loud that n=20 is noisy (PRD 9.3). */
export const EVAL_BANNER =
  "n=20 synthetic test cases. Metrics stabilize with the ~200 labeled appeals per payer specified for Phase 1.";

/** PRD 9.3, shown under the history table. */
export const REFERENCE_NOTE =
  "Only the reference run is quoted as the prototype's result. Iteration runs are on the cheaper draft model and exist to show deltas.";
