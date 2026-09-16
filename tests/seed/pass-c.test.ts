import { describe, expect, it } from "vitest";
import { readArtifact } from "../../scripts/seed/artifacts";
import { buildCriteria } from "../../scripts/seed/pass-a-criteria";
import { buildCaseSeeds, type CaseSeed } from "../../scripts/seed/pass-b-cases";
import {
  chartInputHash,
  chartInputs,
  checkChart,
  documentPlan,
  MAX_LINE_LENGTH,
  normalizeChart,
  renderChartPrompt,
  type ChartArtifact,
  type ChartOutput,
} from "../../scripts/seed/pass-c-charts";
import { parseSeedArgs } from "../../scripts/seed/args";
import { LEAKAGE_SHINGLE, sharedShingles } from "../../scripts/seed/text-checks";

const criteria = buildCriteria();
const { cases } = buildCaseSeeds(criteria);
const seedFor = (id: string): CaseSeed => cases.find((c) => c.denialId === id)!;

/** The committed DEMO-03 chart is a real generated fixture that passed every check. */
function demo03Output(): ChartOutput {
  const chart = readArtifact<ChartArtifact>("charts/DEMO-03.json");
  if (!chart) throw new Error("fixture scripts/seed/data/charts/DEMO-03.json is missing");
  return {
    documents: chart.documents.map((d) => ({ doc_type: d.docType, title: d.title, lines: [...d.lines] })),
  };
}

/** Append a line to the first document. */
function withExtraLine(output: ChartOutput, line: string): ChartOutput {
  const copy = structuredClone(output);
  copy.documents[0].lines.push(line);
  return copy;
}

describe("renderChartPrompt (anti-leakage, PRD 8.2)", () => {
  it("never contains clause text for any case", () => {
    for (const seed of cases) {
      const { system, user } = renderChartPrompt(chartInputs(seed));
      const clauseTexts = criteria.clauses
        .filter((c) => c.payerId === seed.payerId && c.condition === seed.condition)
        .map((c) => c.text);
      expect(sharedShingles(`${system}\n${user}`, clauseTexts, LEAKAGE_SHINGLE), seed.denialId).toEqual([]);
    }
  });

  it("never contains clause codes, payer names, the denial category, or the route", () => {
    const leaks = /\b(?:CHF|SEP|COPD|PNA)-\d{2}\b|meridian|cascade|northgate|medical_necessity|level_of_care|needs_docs|needs_review|do_not_appeal|denial/i;
    for (const seed of cases) {
      const { system, user } = renderChartPrompt(chartInputs(seed));
      expect(leaks.test(`${system}\n${user}`), seed.denialId).toBe(false);
    }
  });

  it("asks DEMO-03 to omit lactate and lists no lactate finding", () => {
    const inputs = chartInputs(seedFor("DEMO-03"));
    expect(inputs.omit.some((o) => /lactate/i.test(o))).toBe(true);
    expect(inputs.document.some((d) => /lactate/i.test(d.fact))).toBe(false);
  });

  it("uses the weak hypoxia fact for DEMO-04", () => {
    const inputs = chartInputs(seedFor("DEMO-04"));
    expect(inputs.document.find((d) => d.mention === "SpO2")?.fact).toMatch(/SpO2 93% on RA/);
  });
});

describe("documentPlan", () => {
  it("gives full cases four documents in hp, progress, progress, discharge order", () => {
    expect(documentPlan(seedFor("DEMO-01")).map((d) => d.docType)).toEqual(["hp", "progress", "progress", "discharge"]);
  });

  it("gives pre-triaged rows a short two-document chart", () => {
    expect(documentPlan(seedFor("DNA-01")).map((d) => d.docType)).toEqual(["hp", "discharge"]);
  });
});

describe("chartInputHash", () => {
  it("is stable for the same case", () => {
    expect(chartInputHash(chartInputs(seedFor("CASE-007")))).toBe(chartInputHash(chartInputs(seedFor("CASE-007"))));
  });

  it("changes when a clause's support changes", () => {
    const seed = structuredClone(seedFor("DEMO-01"));
    const before = chartInputHash(chartInputs(seed));
    seed.clauses.find((c) => c.key === "bnp")!.support = "absent";
    expect(chartInputHash(chartInputs(seed))).not.toBe(before);
  });
});

describe("normalizeChart", () => {
  it("drops blank lines and replaces em and en dashes", () => {
    const out = normalizeChart({
      documents: [{ doc_type: "hp", title: "H&P — Admit", lines: ["HPI:", "", "   ", "Fever 3–4 days"] }],
    });
    expect(out.documents[0]).toEqual({ doc_type: "hp", title: "H&P - Admit", lines: ["HPI:", "Fever 3-4 days"] });
  });
});

describe("checkChart", () => {
  const seed = seedFor("DEMO-03");

  it("accepts the committed DEMO-03 chart", () => {
    expect(checkChart(demo03Output(), seed, criteria)).toBeNull();
  });

  it("rejects a chart that documents an omitted finding", () => {
    const result = checkChart(withExtraLine(demo03Output(), "Lactate 3.4 mmol/L at 03:00."), seed, criteria);
    expect(result).toMatch(/must omit lactate repeat vitals, but found: lactate/);
  });

  it("rejects a chart missing a required key term", () => {
    const output = demo03Output();
    for (const doc of output.documents) {
      doc.lines = doc.lines.map((l) => l.replace(/norepinephrine/gi, "pressor support"));
    }
    expect(checkChart(output, seed, criteria)).toMatch(/key term \[norepinephrine\] is missing/);
  });

  it("rejects a chart that copies criteria phrasing", () => {
    const clause = criteria.clauses.find((c) => c.payerId === "northgate" && c.condition === "sepsis")!;
    expect(checkChart(withExtraLine(demo03Output(), clause.text), seed, criteria)).toMatch(/uses criteria phrasing/);
  });

  it("rejects a clause code", () => {
    expect(checkChart(withExtraLine(demo03Output(), "Meets SEP-02."), seed, criteria)).toMatch(/clause code/);
  });

  it("rejects a payer name", () => {
    expect(checkChart(withExtraLine(demo03Output(), "Northgate case manager called."), seed, criteria)).toMatch(
      /payer or criteria vendor words: northgate/,
    );
  });

  it("does not treat the mcg dosing unit as a criteria vendor", () => {
    expect(checkChart(withExtraLine(demo03Output(), "Norepinephrine 0.08 mcg/kg/min."), seed, criteria)).toBeNull();
  });

  it("rejects a calendar date", () => {
    expect(checkChart(withExtraLine(demo03Output(), "Seen in clinic 3/14/2026."), seed, criteria)).toMatch(
      /calendar date/,
    );
  });

  it("does not treat a blood pressure as a date", () => {
    expect(checkChart(withExtraLine(demo03Output(), "BP 118/72 at rest."), seed, criteria)).toBeNull();
  });

  it("rejects a clinician name", () => {
    expect(checkChart(withExtraLine(demo03Output(), "Discussed with Dr. Alvarez."), seed, criteria)).toMatch(
      /person's name/,
    );
  });

  it("rejects documents in the wrong order", () => {
    const output = demo03Output();
    output.documents.reverse();
    expect(checkChart(output, seed, criteria)).toMatch(/documents must be \[hp,progress,progress,discharge\]/);
  });

  it("rejects an over-long line", () => {
    const long = "x".repeat(MAX_LINE_LENGTH + 1);
    expect(checkChart(withExtraLine(demo03Output(), long), seed, criteria)).toMatch(/exceed 240 characters/);
  });

  it("rejects a document far outside its line range", () => {
    const output = demo03Output();
    output.documents[1].lines = output.documents[1].lines.slice(0, 5);
    expect(checkChart(output, seed, criteria)).toMatch(/Progress Note, HD2 morning has 5 lines/);
  });
});

describe("parseSeedArgs", () => {
  it("defaults to no generation and concurrency 6", () => {
    expect(parseSeedArgs([])).toEqual({ generate: false, regenerate: new Set(), concurrency: 6, skipLoad: false });
  });

  it("treats --regenerate as implying --generate", () => {
    const args = parseSeedArgs(["--regenerate=DEMO-01,CASE-007"]);
    expect(args.generate).toBe(true);
    expect(args.regenerate).toEqual(new Set(["DEMO-01", "CASE-007"]));
  });

  it("accepts --regenerate=all", () => {
    expect(parseSeedArgs(["--regenerate=all"]).regenerate).toBe("all");
  });

  it("rejects an unknown flag", () => {
    expect(() => parseSeedArgs(["--genrate"])).toThrow(/Unknown argument/);
  });

  it("rejects an out-of-range concurrency", () => {
    expect(() => parseSeedArgs(["--concurrency=0"])).toThrow(/concurrency/);
  });
});
