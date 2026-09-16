/**
 * Pass E: ground truth labels.
 *
 * Derived from the case seeds and the criteria sets, with no LLM. The labels
 * are recomputed here from raw inputs rather than copied from pass B's
 * `intendedRoute`, and the two must agree: a mismatch throws. That makes the
 * eval's answer key independent of the generator that produced the data.
 *
 * PRD 8.2 pass E also calls for a human spot check of 8 cases. This pass
 * writes a review sheet for those cases and reads back any corrections from
 * spot-checks.json. Until a human fills it in, every case is labeled
 * unchecked, and the seed output says so.
 *
 * Run standalone: npx tsx scripts/seed/pass-e-truth.ts
 */

import type { DenialCategory, Route, RootCause } from "../../src/lib/domain";
import { readArtifact, writeArtifact } from "./artifacts";
import { CONDITION_LABEL } from "./catalog";
import type { CriteriaArtifact } from "./pass-a-criteria";
import {
  buildCaseSeeds,
  clausesFor,
  deadlineDays,
  routeFromSupport,
  triageFromInputs,
  type CaseSeed,
} from "./pass-b-cases";
import { chartStatus } from "./pass-c-charts";

export const SPOT_CHECK_COUNT = 8;
const SPOT_CHECK_FILE = "spot-checks.json";
const SHEET_FILE = "spot-check-sheet.md";

export interface GroundTruthRecord {
  denialId: string;
  category: DenialCategory;
  rootCause: RootCause;
  metClauseIds: string[];
  unmetRequiredClauseIds: string[];
  expectedRoute: Route;
  /** Clinically supportable: no required clause is unmet. Independent of triage. */
  winnable: boolean;
  /** A reviewer would approve an ideal draft without edits. */
  approveAsIs: boolean;
  spotChecked: boolean;
  spotCheckNote: string | null;
}

export interface GroundTruthArtifact {
  cases: GroundTruthRecord[];
}

/** One entry per spot-checked case. A human sets checked and may add corrections. */
export interface SpotCheck {
  denialId: string;
  checked: boolean;
  note: string;
  corrections?: Partial<Pick<GroundTruthRecord, "category" | "rootCause" | "expectedRoute" | "winnable" | "approveAsIs">>;
}

export interface SpotCheckFile {
  /** Written by pass E; a human edits `checked`, `note` and `corrections`. */
  cases: SpotCheck[];
}

/** Labels for one case, derived from its seed. */
export function deriveGroundTruth(seed: CaseSeed, criteria: CriteriaArtifact): GroundTruthRecord {
  const triage = triageFromInputs(seed, criteria);
  const expectedRoute = routeFromSupport(triage, seed.clauses);
  const unmetRequiredClauseIds = seed.clauses
    .filter((c) => c.required && c.support === "unmet")
    .map((c) => c.clauseId);

  return {
    denialId: seed.denialId,
    category: seed.category,
    rootCause: seed.rootCause,
    metClauseIds: seed.clauses
      .filter((c) => c.support === "strong" || c.support === "weak")
      .map((c) => c.clauseId),
    unmetRequiredClauseIds,
    expectedRoute,
    winnable: unmetRequiredClauseIds.length === 0,
    approveAsIs: expectedRoute === "ready",
    spotChecked: false,
    spotCheckNote: null,
  };
}

/**
 * The 8 cases put in front of a human: all four demo cases, then the two test
 * and two dev cases whose routes vary most, chosen deterministically by ID.
 */
export function spotCheckSelection(cases: CaseSeed[]): string[] {
  const demo = cases.filter((c) => c.denialId.startsWith("DEMO-")).map((c) => c.denialId);
  const pick = (split: string, n: number): string[] => {
    const inSplit = cases.filter((c) => c.split === split);
    const byRoute = new Map<Route, CaseSeed[]>();
    for (const c of inSplit) byRoute.set(c.intendedRoute, [...(byRoute.get(c.intendedRoute) ?? []), c]);
    const routes = [...byRoute.keys()].sort();
    return routes
      .map((route) => byRoute.get(route)!.map((c) => c.denialId).sort()[0])
      .slice(0, n);
  };
  return [...demo, ...pick("test", 2), ...pick("dev", 2)].slice(0, SPOT_CHECK_COUNT);
}

/** Apply a human's corrections. Throws if a correction names an unknown case. */
export function applySpotChecks(
  records: GroundTruthRecord[],
  file: SpotCheckFile | undefined,
): GroundTruthRecord[] {
  if (!file) return records;
  const byId = new Map(records.map((r) => [r.denialId, r]));
  for (const entry of file.cases) {
    if (!byId.has(entry.denialId)) {
      throw new Error(`spot-checks.json names unknown case ${entry.denialId}`);
    }
  }
  return records.map((record) => {
    const entry = file.cases.find((c) => c.denialId === record.denialId);
    if (!entry || !entry.checked) return record;
    return {
      ...record,
      ...(entry.corrections ?? {}),
      spotChecked: true,
      spotCheckNote: entry.note || null,
    };
  });
}

export interface PassEResult {
  artifact: GroundTruthArtifact;
  spotChecked: number;
  spotCheckTotal: number;
}

/**
 * Labels for every case, with the independence check. Pure: no file IO, so
 * tests can call it freely.
 */
export function deriveAll(cases: CaseSeed[], criteria: CriteriaArtifact): GroundTruthRecord[] {
  const derived = cases.map((seed) => deriveGroundTruth(seed, criteria));

  // The answer key must agree with how the data was built.
  const mismatches = derived
    .map((record, i) => ({ record, seed: cases[i] }))
    .filter(({ record, seed }) => record.expectedRoute !== seed.intendedRoute)
    .map(({ record, seed }) => `${seed.denialId}: seed intended ${seed.intendedRoute}, derived ${record.expectedRoute}`);
  if (mismatches.length > 0) {
    throw new Error(`Pass E disagrees with pass B:\n- ${mismatches.join("\n- ")}`);
  }
  return derived;
}

export function runPassE(cases: CaseSeed[], criteria: CriteriaArtifact): PassEResult {
  const derived = deriveAll(cases, criteria);
  const selection = spotCheckSelection(cases);
  const existing = readArtifact<SpotCheckFile>(SPOT_CHECK_FILE);
  const file: SpotCheckFile = {
    cases: selection.map(
      (denialId) =>
        existing?.cases.find((c) => c.denialId === denialId) ?? { denialId, checked: false, note: "" },
    ),
  };
  writeArtifact(SPOT_CHECK_FILE, file);
  writeArtifact(SHEET_FILE, buildSpotCheckSheet(selection, cases, criteria, derived));

  const cleared = applySpotChecks(derived, file);
  return {
    artifact: { cases: cleared },
    spotChecked: cleared.filter((c) => c.spotChecked).length,
    spotCheckTotal: selection.length,
  };
}

/** A reviewable sheet: inputs, chart, and derived labels for each selected case. */
function buildSpotCheckSheet(
  selection: string[],
  cases: CaseSeed[],
  criteria: CriteriaArtifact,
  derived: GroundTruthRecord[],
): string {
  const lines: string[] = [
    "# Ground truth spot check",
    "",
    `${selection.length} cases for human review (PRD 8.2 pass E). For each case, read the chart and`,
    "the clause support below, then confirm or correct the derived labels.",
    "",
    "Record the result in `scripts/seed/data/spot-checks.json`: set `checked` to true, add a",
    "`note`, and add a `corrections` object for any label that is wrong. Then rerun `npm run db:seed`.",
    "",
  ];

  for (const id of selection) {
    const seed = cases.find((c) => c.denialId === id)!;
    const truth = derived.find((t) => t.denialId === id)!;
    const set = clausesFor(criteria, seed.payerId, seed.condition);
    const chart = chartStatus(seed, criteria).chart;
    const payer = criteria.payers.find((p) => p.id === seed.payerId)!;

    lines.push(
      `## ${id} (${seed.split})`,
      "",
      `- Payer: ${payer.name} (${payer.criteriaStyle}), ${CONDITION_LABEL[seed.condition]}, DRG ${seed.patient.drg}`,
      `- Amount $${seed.amount.toLocaleString("en-US")}, ${deadlineDays(criteria, seed.payerId) - seed.daysSinceReceived} days left, triage: ${seed.triage}`,
      `- Patient: ${seed.patient.age}-year-old ${seed.patient.sex === "F" ? "female" : "male"}, LOS ${seed.patient.losDays} days`,
      seed.purpose ? `- Purpose: ${seed.purpose}` : "",
      "",
      "### Clause support",
      "",
      "| Clause | Code | Required | Support | Criterion |",
      "| --- | --- | --- | --- | --- |",
      ...seed.clauses.map((c) => {
        const clause = set.find((s) => s.id === c.clauseId)!;
        return `| ${c.clauseId} | ${clause.code} | ${c.required ? "yes" : "no"} | ${c.support} | ${c.key} |`;
      }),
      "",
      "### Derived labels",
      "",
      `- category: ${truth.category}`,
      `- root cause: ${truth.rootCause}`,
      `- expected route: ${truth.expectedRoute}`,
      `- winnable: ${truth.winnable}`,
      `- approve as is: ${truth.approveAsIs}`,
      `- unmet required: ${truth.unmetRequiredClauseIds.join(", ") || "none"}`,
      "",
      "### Chart",
      "",
    );

    if (!chart) {
      lines.push("_Chart not generated yet._", "");
      continue;
    }
    let n = 0;
    for (const doc of chart.documents) {
      lines.push(`**${doc.title}** (${doc.docType})`, "", "```");
      for (const line of doc.lines) lines.push(`L${++n}: ${line}`);
      lines.push("```", "");
    }
  }
  return lines.filter((l) => l !== "").join("\n").replace(/\n(#{2,3} )/g, "\n\n$1") + "\n";
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed/pass-e-truth.ts")) {
  const main = async (): Promise<void> => {
    const { buildCriteria } = await import("./pass-a-criteria");
    const criteria = buildCriteria();
    const { cases } = buildCaseSeeds(criteria);
    const result = runPassE(cases, criteria);
    const tally = (route: Route) => result.artifact.cases.filter((c) => c.expectedRoute === route).length;
    console.log(`ground truth: ${result.artifact.cases.length} cases`);
    console.log(
      `  ready ${tally("ready")}, needs_review ${tally("needs_review")}, ` +
        `needs_docs ${tally("needs_docs")}, do_not_appeal ${tally("do_not_appeal")}`,
    );
    console.log(`  winnable ${result.artifact.cases.filter((c) => c.winnable).length}`);
    console.log(`  spot checks completed: ${result.spotChecked} of ${result.spotCheckTotal}`);
  };
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
