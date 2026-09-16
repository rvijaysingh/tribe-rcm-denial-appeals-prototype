/**
 * Pass C: synthetic charts.
 *
 * One LLM call per case. The prompt is built from the case seed's clinical
 * facts only: catalog strong/weak facts to document and omit instructions for
 * unsupported criteria. It never contains clause text, clause codes, payer
 * names, the denial, or the route (PRD 8.2 anti-leakage rule).
 *
 * Each chart is checked deterministically before it is accepted; see
 * checkChart(). Accepted charts are written to scripts/seed/data/charts/ and
 * committed. They are regenerated only when asked, or when their inputs
 * change (detected by inputHash), and only with --generate.
 *
 * Run standalone on one case (calls the API):
 *   npx tsx scripts/seed/pass-c-charts.ts --case DEMO-03
 */

import { z } from "zod";
import { DOC_TYPES, type DocType } from "../../src/lib/domain";
import { generateStructured } from "../../src/lib/llm";
import { SEED_MODEL } from "../../src/lib/models";
import { artifactExists, readArtifact, sha256, writeArtifact } from "./artifacts";
import { CATALOG, CONDITION_LABEL, criterion } from "./catalog";
import { mapPool } from "./concurrency";
import type { CriteriaArtifact } from "./pass-a-criteria";
import type { CaseSeed } from "./pass-b-cases";
import { loadPrompt, renderTemplate } from "./prompts";
import {
  CALENDAR_DATE,
  LEAKAGE_SHINGLE,
  PERSON_NAME,
  containsTerm,
  matchedTerms,
  normalizeDashes,
  sharedShingles,
} from "./text-checks";

export const CHART_PROMPT_VERSION = "chart.v1";

// ------------------------------------------------------------------- schema

/**
 * Wire schema: shape only, no size limits. Structured outputs cannot enforce
 * string lengths or array bounds, so putting them here makes an over-long line
 * a fatal SDK parse error instead of something checkChart can retry. Size
 * rules live in checkChart().
 */
export const ChartOutputSchema = z.object({
  documents: z.array(
    z.object({
      doc_type: z.enum(DOC_TYPES),
      title: z.string(),
      // Blank strings are allowed here and removed by normalizeChart().
      lines: z.array(z.string()),
    }),
  ),
});

/** Longest acceptable chart line. The prompt asks for under 200 characters. */
export const MAX_LINE_LENGTH = 240;
export type ChartOutput = z.infer<typeof ChartOutputSchema>;

export interface ChartDocument {
  docType: DocType;
  title: string;
  lines: string[];
}

export interface ChartArtifact {
  denialId: string;
  accountId: string;
  promptVersion: string;
  model: string;
  /** Hash of the clinical inputs. A mismatch means the chart is stale. */
  inputHash: string;
  generatedAt: string;
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  documents: ChartDocument[];
}

// ------------------------------------------------------------------- inputs

interface PlannedDoc {
  docType: DocType;
  label: string;
  minLines: number;
  maxLines: number;
}

export interface ChartInputs {
  age: number;
  sex: "female" | "male";
  conditionLabel: string;
  losDays: number;
  plan: PlannedDoc[];
  /** Findings to document: key term plus the fact text. */
  document: { mention: string; fact: string }[];
  /** Omit instructions for unsupported criteria. */
  omit: string[];
}

/** Document plan. Pre-triaged queue rows get a short two-document chart. */
export function documentPlan(seed: CaseSeed): PlannedDoc[] {
  if (seed.shortChart) {
    return [
      { docType: "hp", label: "History and Physical, admission", minLines: 16, maxLines: 26 },
      { docType: "discharge", label: "Discharge Summary", minLines: 10, maxLines: 18 },
    ];
  }
  const secondNoteDay = Math.max(2, seed.patient.losDays - 1);
  return [
    { docType: "hp", label: "History and Physical, admission", minLines: 38, maxLines: 58 },
    { docType: "progress", label: "Progress Note, HD2 morning", minLines: 16, maxLines: 30 },
    {
      docType: "progress",
      label: `Progress Note, HD${secondNoteDay}${secondNoteDay === 2 ? " afternoon" : ""}`,
      minLines: 16,
      maxLines: 30,
    },
    { docType: "discharge", label: "Discharge Summary", minLines: 20, maxLines: 34 },
  ];
}

/**
 * The clinical inputs for one chart. Findings are listed in catalog order, not
 * payer clause order, so the list carries no hint of which clauses a payer
 * treats as required.
 */
export function chartInputs(seed: CaseSeed): ChartInputs {
  const byKey = new Map(seed.clauses.map((c) => [c.key, c]));
  const document: ChartInputs["document"] = [];
  const omit: string[] = [];

  for (const entry of CATALOG[seed.condition]) {
    const clause = byKey.get(entry.key);
    if (!clause) continue;
    if (clause.support === "strong") document.push({ mention: entry.mention, fact: entry.strong });
    else if (clause.support === "weak") document.push({ mention: entry.mention, fact: entry.weak });
    else {
      if (!entry.omit) throw new Error(`${seed.denialId}: ${entry.key} omitted but has no omit text`);
      omit.push(entry.omit);
    }
  }

  return {
    age: seed.patient.age,
    sex: seed.patient.sex === "F" ? "female" : "male",
    conditionLabel: CONDITION_LABEL[seed.condition],
    losDays: seed.patient.losDays,
    plan: documentPlan(seed),
    document,
    omit,
  };
}

export function chartInputHash(inputs: ChartInputs): string {
  return sha256(JSON.stringify(inputs));
}

export function renderChartPrompt(inputs: ChartInputs): { system: string; user: string } {
  const system = loadPrompt(`chart-system.${CHART_PROMPT_VERSION.split(".")[1]}.md`);
  const user = renderTemplate(loadPrompt(`chart-user.${CHART_PROMPT_VERSION.split(".")[1]}.md`), {
    age: inputs.age,
    sex: inputs.sex,
    condition_label: inputs.conditionLabel,
    los_days: inputs.losDays,
    document_plan: inputs.plan
      .map((d, i) => `${i + 1}. doc_type "${d.docType}": ${d.label}, ${d.minLines} to ${d.maxLines} lines`)
      .join("\n"),
    document_findings: inputs.document.map((d) => `- [${d.mention}] ${d.fact}`).join("\n"),
    omit_findings: inputs.omit.length > 0 ? inputs.omit.map((o) => `- ${o}`).join("\n") : "- Nothing to omit.",
  });
  return { system, user };
}

// ------------------------------------------------------------------- checks

// Not bare "mcg": it is the standard dosing unit (norepinephrine mcg/kg/min).
const PAYER_WORDS = [
  "pinnacle",
  "cascade",
  "northgate",
  "interqual",
  "mcg-style",
  "mcg style",
  "mcg guideline*",
  "milliman",
  "utilization review",
];
const CLAUSE_CODE = /\b(?:CHF|SEP|COPD|PNA)-\d{2}\b/;
const LINE_ID_PREFIX = /^\s*L\d+\b/;

/**
 * Lossless cleanup of model output: drop blank separator lines, which carry no
 * content and would waste citable line IDs, and replace em and en dashes.
 */
export function normalizeChart(output: ChartOutput): ChartOutput {
  return {
    documents: output.documents.map((d) => ({
      ...d,
      title: normalizeDashes(d.title).trim(),
      lines: d.lines.map((l) => normalizeDashes(l).trimEnd()).filter((l) => l.trim().length > 0),
    })),
  };
}

/**
 * Deterministic acceptance checks for one generated chart. Returns null when
 * the chart passes, or every problem found, joined, for the retry prompt.
 */
export function checkChart(
  output: ChartOutput,
  seed: CaseSeed,
  criteria: CriteriaArtifact,
): string | null {
  const problems: string[] = [];
  const plan = documentPlan(seed);
  const docs = output.documents;

  const gotTypes = docs.map((d) => d.doc_type).join(",");
  const wantTypes = plan.map((d) => d.docType).join(",");
  if (gotTypes !== wantTypes) problems.push(`documents must be [${wantTypes}] in order, got [${gotTypes}]`);

  docs.forEach((doc, i) => {
    const p = plan[i];
    if (!p) return;
    // Allow 25% slack on the requested range before rejecting.
    const min = Math.floor(p.minLines * 0.75);
    const max = Math.ceil(p.maxLines * 1.25);
    if (doc.lines.length < min || doc.lines.length > max) {
      problems.push(`${p.label} has ${doc.lines.length} lines; expected ${p.minLines} to ${p.maxLines}`);
    }
  });

  const overLong = docs.flatMap((d) => d.lines).filter((l) => l.length > MAX_LINE_LENGTH);
  if (overLong.length > 0) {
    problems.push(
      `${overLong.length} line(s) exceed ${MAX_LINE_LENGTH} characters, starting: "${overLong[0].slice(0, 60)}..."`,
    );
  }

  const allLines = docs.flatMap((d) => d.lines.map(normalizeDashes));
  const text = allLines.join("\n");

  for (const clause of seed.clauses) {
    const c = criterion(seed.condition, clause.key);
    if (clause.support === "strong" || clause.support === "weak") {
      if (!containsTerm(text, c.mention)) problems.push(`key term [${c.mention}] is missing`);
    } else {
      const hits = matchedTerms(text, c.forbid);
      if (hits.length > 0) problems.push(`must omit ${c.key.replace(/_/g, " ")}, but found: ${hits.join(", ")}`);
    }
  }

  const policyText = [
    ...criteria.clauses.filter((c) => c.payerId === seed.payerId && c.condition === seed.condition).map((c) => c.text),
    ...Object.values(CATALOG[seed.condition]).flatMap((c) => Object.values(c.clause)),
    ...criteria.payerNotes.filter((n) => n.payerId === seed.payerId && n.condition === seed.condition).map((n) => n.text),
  ];
  const leaked = sharedShingles(text, policyText, LEAKAGE_SHINGLE);
  if (leaked.length > 0) problems.push(`uses criteria phrasing: "${leaked.slice(0, 3).join('", "')}"`);

  const payerHits = matchedTerms(text, PAYER_WORDS);
  if (payerHits.length > 0) problems.push(`contains payer or criteria vendor words: ${payerHits.join(", ")}`);
  if (CLAUSE_CODE.test(text)) problems.push("contains a criteria clause code");

  const dated = allLines.find((l) => CALENDAR_DATE.test(l));
  if (dated) problems.push(`contains a calendar date or year: "${dated.slice(0, 80)}"`);
  const named = allLines.find((l) => PERSON_NAME.test(l));
  if (named) problems.push(`contains a person's name: "${named.slice(0, 80)}"`);
  if (allLines.some((l) => LINE_ID_PREFIX.test(l))) problems.push("lines must not start with line numbers");

  return problems.length > 0 ? problems.join("; ") : null;
}

// --------------------------------------------------------------- generation

function chartPath(denialId: string): string {
  return `charts/${denialId}.json`;
}

export async function generateChart(seed: CaseSeed, criteria: CriteriaArtifact): Promise<ChartArtifact> {
  const inputs = chartInputs(seed);
  const { system, user } = renderChartPrompt(inputs);

  const result = await generateStructured({
    label: `chart:${seed.denialId}`,
    model: SEED_MODEL,
    system,
    prompt: user,
    schema: ChartOutputSchema,
    maxTokens: 20000,
    effort: "medium",
    normalize: normalizeChart,
    check: (output) => checkChart(output, seed, criteria),
  });

  return {
    denialId: seed.denialId,
    accountId: seed.accountId,
    promptVersion: CHART_PROMPT_VERSION,
    model: result.servedModel,
    inputHash: chartInputHash(inputs),
    generatedAt: new Date().toISOString(),
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: Number(result.costUsd.toFixed(6)),
    documents: result.data.documents.map((d) => ({ docType: d.doc_type, title: d.title, lines: d.lines })),
  };
}

export type ChartStatus = "ok" | "missing" | "stale" | "failed_checks";

export interface PassCOptions {
  generate: boolean;
  /** Case IDs to regenerate regardless of status, or "all". */
  regenerate: ReadonlySet<string> | "all";
  concurrency: number;
}

export interface PassCResult {
  charts: Map<string, ChartArtifact>;
  generated: string[];
  costUsd: number;
}

/** Status of the committed chart for a case. Re-runs the checks, so a catalog change cannot slip past. */
export function chartStatus(
  seed: CaseSeed,
  criteria: CriteriaArtifact,
): { status: ChartStatus; chart?: ChartArtifact; detail?: string } {
  if (!artifactExists(chartPath(seed.denialId))) return { status: "missing" };
  const chart = readArtifact<ChartArtifact>(chartPath(seed.denialId))!;
  if (chart.inputHash !== chartInputHash(chartInputs(seed))) return { status: "stale", chart };
  const problem = checkChart(
    { documents: chart.documents.map((d) => ({ doc_type: d.docType, title: d.title, lines: d.lines })) },
    seed,
    criteria,
  );
  if (problem) return { status: "failed_checks", chart, detail: problem };
  return { status: "ok", chart };
}

export async function runPassC(
  cases: CaseSeed[],
  criteria: CriteriaArtifact,
  options: PassCOptions,
): Promise<PassCResult> {
  const charts = new Map<string, ChartArtifact>();
  const todo: { seed: CaseSeed; reason: string }[] = [];

  for (const seed of cases) {
    const forced = options.regenerate === "all" || options.regenerate.has(seed.denialId);
    const { status, chart, detail } = chartStatus(seed, criteria);
    if (status === "ok" && !forced) {
      charts.set(seed.denialId, chart!);
    } else {
      todo.push({ seed, reason: forced ? "regenerate requested" : `${status}${detail ? `: ${detail}` : ""}` });
    }
  }

  if (todo.length === 0) return { charts, generated: [], costUsd: 0 };

  if (!options.generate) {
    const list = todo.map((t) => `  ${t.seed.denialId}: ${t.reason}`).join("\n");
    throw new Error(
      `${todo.length} chart(s) need generation, which calls the Anthropic API:\n${list}\n` +
        `Rerun with --generate to create them.`,
    );
  }

  console.log(`Pass C: generating ${todo.length} chart(s) with ${SEED_MODEL}, concurrency ${options.concurrency}`);
  let costUsd = 0;
  const generated: string[] = [];
  const outcomes = await mapPool(todo, options.concurrency, async ({ seed }) => {
    const started = Date.now();
    const chart = await generateChart(seed, criteria);
    // Save immediately so an interrupted run keeps its progress.
    writeArtifact(chartPath(seed.denialId), chart);
    const lines = chart.documents.reduce((n, d) => n + d.lines.length, 0);
    console.log(
      `  ${seed.denialId.padEnd(9)} ok  attempts ${chart.attempts}  ${String(lines).padStart(3)} lines  ` +
        `$${chart.costUsd.toFixed(3)}  ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    return chart;
  });

  const failures: string[] = [];
  outcomes.forEach((outcome, i) => {
    const id = todo[i].seed.denialId;
    if (outcome.status === "fulfilled") {
      charts.set(id, outcome.value);
      generated.push(id);
      costUsd += outcome.value.costUsd;
    } else {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.error(`  ${id.padEnd(9)} FAILED  ${message.slice(0, 300)}`);
      failures.push(id);
    }
  });

  if (failures.length > 0) {
    throw new Error(
      `Pass C: ${failures.length} chart(s) failed: ${failures.join(", ")}. ` +
        `${generated.length} succeeded and were saved; rerun with --generate to retry the rest.`,
    );
  }
  return { charts, generated, costUsd };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed/pass-c-charts.ts")) {
  const main = async (): Promise<void> => {
    await import("./load-env");
    const { buildCriteria } = await import("./pass-a-criteria");
    const { buildCaseSeeds } = await import("./pass-b-cases");
    const caseArg = process.argv.indexOf("--case");
    const id = caseArg > -1 ? process.argv[caseArg + 1] : undefined;
    if (!id) throw new Error("Usage: npx tsx scripts/seed/pass-c-charts.ts --case <DENIAL_ID> [--print-prompt]");

    const criteria = buildCriteria();
    const seed = buildCaseSeeds(criteria).cases.find((c) => c.denialId === id);
    if (!seed) throw new Error(`No case ${id}`);

    if (process.argv.includes("--print-prompt")) {
      const { system, user } = renderChartPrompt(chartInputs(seed));
      console.log(`--- system ---\n${system}\n--- user ---\n${user}`);
      return;
    }
    const chart = await generateChart(seed, criteria);
    writeArtifact(chartPath(id), chart);
    let n = 0;
    for (const doc of chart.documents) {
      console.log(`\n=== ${doc.title} (${doc.docType}) ===`);
      for (const line of doc.lines) console.log(`L${++n}: ${line}`);
    }
    console.log(`\nmodel ${chart.model}, attempts ${chart.attempts}, ${chart.tokensIn} in / ${chart.tokensOut} out, $${chart.costUsd}`);
  };
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
