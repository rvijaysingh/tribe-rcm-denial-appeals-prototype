/**
 * Pass D: denial letters and precedent appeals.
 *
 * Denial letters (one per case) are generated from the case seed plus clause
 * codes and the payer's finding for each cited code. The generator never sees
 * clause text or the chart. Letters carry date placeholder tokens such as
 * [[ADMIT_DATE]]; the loader fills them relative to the seed day, so the
 * committed text never goes stale.
 *
 * Precedent appeals (4 to 6 per payer and category) are generated per group.
 * Outcome counts are derived from WIN_RATE so the precedent store and the
 * triage table agree, including which side of the 40% payer-history warning
 * each pair falls on (PRD 6.3).
 *
 * Run standalone (calls the API):
 *   npx tsx scripts/seed/pass-d-letters.ts --case DEMO-03
 *   npx tsx scripts/seed/pass-d-letters.ts --precedents pinnacle:medical_necessity
 */

import { z } from "zod";
import {
  CONDITIONS,
  DENIAL_CATEGORIES,
  PAYER_IDS,
  type Condition,
  type DenialCategory,
  type PayerId,
  type PrecedentOutcome,
  type RootCause,
} from "../../src/lib/domain";
import { PAYER_HISTORY_WARN_THRESHOLD, WIN_RATE } from "../../src/lib/economics";
import { generateStructured } from "../../src/lib/llm";
import { SEED_MODEL } from "../../src/lib/models";
import { artifactExists, readArtifact, sha256, writeArtifact } from "./artifacts";
import { CATALOG, CONDITION_LABEL, criterion } from "./catalog";
import { mapPool } from "./concurrency";
import type { CriteriaArtifact } from "./pass-a-criteria";
import { deadlineDays, type CaseSeed } from "./pass-b-cases";
import { loadPrompt, renderTemplate } from "./prompts";
import { createRng } from "./rng";
import {
  CALENDAR_DATE,
  LEAKAGE_SHINGLE,
  PERSON_NAME,
  normalizeDashes,
  sharedShingles,
} from "./text-checks";

export const LETTER_PROMPT_VERSION = "letter.v1";
export const PRECEDENT_PROMPT_VERSION = "precedent.v1";

export const DATE_TOKENS = ["[[LETTER_DATE]]", "[[ADMIT_DATE]]", "[[DISCHARGE_DATE]]", "[[APPEAL_DEADLINE]]"] as const;

const CRITERIA_LABEL = { interqual_style: "InterQual-style", mcg_style: "MCG-style" } as const;

const CATEGORY_LABEL: Record<DenialCategory, string> = {
  medical_necessity: "medical necessity",
  level_of_care: "level of care, inpatient versus observation",
};

/** The payer's overall rationale for each root cause. */
export const ROOT_CAUSE_STATEMENT: Record<RootCause, string> = {
  severity_not_documented:
    "The medical record does not document clinical severity sufficient to require inpatient admission.",
  criteria_not_met_at_admission:
    "The documentation available at the time of admission did not meet inpatient criteria.",
  treatment_appropriate_at_lower_level:
    "The services provided could have been delivered safely at a lower level of care, such as observation.",
  los_exceeds_expected:
    "The length of stay exceeded what the documented clinical condition supported.",
};

const SIGNATURE_ROLE = "Medical Director, Utilization Management";

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// =================================================================== letters

/** Shape only. Length rules live in checkLetter() so they can be retried. */
export const LetterOutputSchema = z.object({
  letter_text: z.string(),
});
export type LetterOutput = z.infer<typeof LetterOutputSchema>;

export interface LetterArtifact {
  denialId: string;
  promptVersion: string;
  model: string;
  inputHash: string;
  generatedAt: string;
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  memberId: string;
  claimNumber: string;
  citedCodes: string[];
  /** Letter text with date tokens unfilled. The loader fills them. */
  letterTemplate: string;
}

export interface LetterInputs {
  payerName: string;
  criteriaLabel: string;
  criteriaVersion: string;
  categoryLabel: string;
  memberId: string;
  claimNumber: string;
  conditionLabel: string;
  drg: string;
  carc: string;
  rarc: string;
  rootCauseStatement: string;
  cited: { code: string; finding: string }[];
  appealInstructions: string;
}

/** Deterministic numeric string from a case ID, for synthetic identifiers. */
function digitsFrom(seed: string, length: number): string {
  return BigInt(`0x${sha256(seed).slice(0, 15)}`).toString().padStart(length, "0").slice(-length);
}

/**
 * Codes the payer cites as not met: every required clause the chart does not
 * strongly support, topped up with strongly supported required clauses to at
 * least two, capped at three. Top-up picks are deterministic per case.
 */
export function citedClauses(seed: CaseSeed): CaseSeed["clauses"] {
  const required = seed.clauses.filter((c) => c.required);
  const contested = required.filter((c) => c.support !== "strong");
  const strong = createRng(Number.parseInt(digitsFrom(seed.denialId, 8), 10)).shuffle(
    required.filter((c) => c.support === "strong"),
  );
  const cited = [...contested];
  while (cited.length < 2 && strong.length > 0) cited.push(strong.shift()!);
  return cited.slice(0, 3).sort((a, b) => a.code.localeCompare(b.code));
}

export function letterInputs(seed: CaseSeed, criteria: CriteriaArtifact): LetterInputs {
  const payer = criteria.payers.find((p) => p.id === seed.payerId)!;
  const set = criteria.criteriaSets.find((s) => s.payerId === seed.payerId && s.condition === seed.condition)!;
  return {
    payerName: payer.name,
    criteriaLabel: CRITERIA_LABEL[payer.criteriaStyle],
    criteriaVersion: set.version,
    categoryLabel: CATEGORY_LABEL[seed.category],
    memberId: `MBR${digitsFrom(`member:${seed.denialId}`, 9)}`,
    claimNumber: `CLM${digitsFrom(`claim:${seed.denialId}`, 11)}`,
    conditionLabel: CONDITION_LABEL[seed.condition],
    drg: seed.patient.drg,
    carc: seed.carc,
    rarc: seed.rarc,
    rootCauseStatement: ROOT_CAUSE_STATEMENT[seed.rootCause],
    cited: citedClauses(seed).map((c) => ({
      code: c.code,
      finding: criterion(seed.condition, c.key).payerAssertion,
    })),
    appealInstructions: payer.appealFormatNotes,
  };
}

export function renderLetterPrompt(inputs: LetterInputs): { system: string; user: string } {
  const v = LETTER_PROMPT_VERSION.split(".")[1];
  return {
    system: loadPrompt(`letter-system.${v}.md`),
    user: renderTemplate(loadPrompt(`letter-user.${v}.md`), {
      payer_name: inputs.payerName,
      criteria_label: inputs.criteriaLabel,
      criteria_version: inputs.criteriaVersion,
      category_label: inputs.categoryLabel,
      member_id: inputs.memberId,
      claim_number: inputs.claimNumber,
      condition_label: inputs.conditionLabel,
      drg: inputs.drg,
      carc: inputs.carc,
      rarc: inputs.rarc,
      root_cause_statement: inputs.rootCauseStatement,
      cited_findings: inputs.cited.map((c) => `- ${c.code}: ${c.finding}`).join("\n"),
      appeal_instructions: inputs.appealInstructions,
      signature_role: SIGNATURE_ROLE,
    }),
  };
}

const ANY_CLAUSE_CODE = /\b(?:CHF|SEP|COPD|PNA)-\d{2}\b/g;

/**
 * A letter must not describe itself as the other kind of determination. Stage B
 * classifies the category from this text, so a letter that opens as a medical
 * necessity denial and later says it "applies to the level of care only" would
 * poison both the classification and the eval label.
 *
 * Written to allow a payer's standing appeal boilerplate, such as Northgate's
 * "Level of care denials are not eligible for provider appeal".
 */
const WRONG_DETERMINATION: Record<DenialCategory, RegExp> = {
  medical_necessity:
    /(?:applies to|limited to|addresses|concerns|is)\s+(?:the\s+)?level of care (?:only|determination)|level of care determination\b/i,
  level_of_care: /(?:applies to|limited to|addresses|concerns)\s+medical necessity only\b/i,
};

/** Deterministic acceptance checks for one letter. Null when it passes. */
export function checkLetter(output: LetterOutput, seed: CaseSeed, criteria: CriteriaArtifact): string | null {
  const problems: string[] = [];
  const text = output.letter_text;
  const inputs = letterInputs(seed, criteria);

  for (const token of DATE_TOKENS) {
    if (!text.includes(token)) problems.push(`missing date token ${token}`);
  }
  // Strip the date tokens and the criteria version before looking for dates:
  // the version is a supplied value that looks like a year ("2026.1"), and
  // flagging it made every letter fail its first attempt.
  const withoutTokens = [...DATE_TOKENS, inputs.criteriaVersion].reduce(
    (t, token) => t.split(token).join(" "),
    text,
  );
  const dated = withoutTokens.match(CALENDAR_DATE);
  if (dated) problems.push(`contains a calendar date or year: "${dated[0]}"`);

  for (const required of [inputs.carc, inputs.rarc, inputs.memberId, inputs.claimNumber]) {
    if (!text.includes(required)) problems.push(`missing "${required}"`);
  }

  const citedCodes = inputs.cited.map((c) => c.code);
  for (const code of citedCodes) {
    if (!text.includes(code)) problems.push(`missing cited criteria code ${code}`);
  }
  const extra = [...new Set(text.match(ANY_CLAUSE_CODE) ?? [])].filter((c) => !citedCodes.includes(c));
  if (extra.length > 0) problems.push(`cites criteria codes that were not provided: ${extra.join(", ")}`);

  const clauseTexts = criteria.clauses
    .filter((c) => c.payerId === seed.payerId && c.condition === seed.condition)
    .map((c) => c.text);
  const leaked = sharedShingles(text, clauseTexts, LEAKAGE_SHINGLE);
  if (leaked.length > 0) problems.push(`paraphrases criteria text too closely: "${leaked.slice(0, 2).join('", "')}"`);

  const named = text.match(PERSON_NAME);
  if (named) problems.push(`contains a person's name: "${named[0]}"`);

  const contradiction = text.match(WRONG_DETERMINATION[seed.category]);
  if (contradiction) {
    problems.push(
      `this is a ${seed.category.replace(/_/g, " ")} determination, but the letter says "${contradiction[0]}"`,
    );
  }
  const categoryWords = seed.category === "medical_necessity" ? "medical necessity" : "level of care";
  if (!new RegExp(categoryWords, "i").test(text)) problems.push(`never states it is a ${categoryWords} denial`);

  const count = words(text);
  if (count < 150 || count > 450) problems.push(`${count} words; expected 180 to 380`);

  return problems.length > 0 ? problems.join("; ") : null;
}

export function letterInputHash(inputs: LetterInputs): string {
  return sha256(JSON.stringify(inputs));
}

export async function generateLetter(seed: CaseSeed, criteria: CriteriaArtifact): Promise<LetterArtifact> {
  const inputs = letterInputs(seed, criteria);
  const { system, user } = renderLetterPrompt(inputs);
  const result = await generateStructured({
    label: `letter:${seed.denialId}`,
    model: SEED_MODEL,
    system,
    prompt: user,
    schema: LetterOutputSchema,
    maxTokens: 8000,
    effort: "medium",
    normalize: (o) => ({ letter_text: normalizeDashes(o.letter_text).trim() }),
    check: (o) => checkLetter(o, seed, criteria),
  });
  return {
    denialId: seed.denialId,
    promptVersion: LETTER_PROMPT_VERSION,
    model: result.servedModel,
    inputHash: letterInputHash(inputs),
    generatedAt: new Date().toISOString(),
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: Number(result.costUsd.toFixed(6)),
    memberId: inputs.memberId,
    claimNumber: inputs.claimNumber,
    citedCodes: inputs.cited.map((c) => c.code),
    letterTemplate: result.data.letter_text,
  };
}

/** Format a date for a letter, MM/DD/YYYY in UTC. */
function letterDate(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

/** Fill a letter's date tokens. Throws if any token is left unfilled. */
export function fillLetter(
  template: string,
  dates: { received: Date; admit: Date; discharge: Date },
  deadline: number,
): string {
  const deadlineDate = new Date(dates.received.getTime() + deadline * 86_400_000);
  const filled = template
    .split("[[LETTER_DATE]]").join(letterDate(dates.received))
    .split("[[ADMIT_DATE]]").join(letterDate(dates.admit))
    .split("[[DISCHARGE_DATE]]").join(letterDate(dates.discharge))
    .split("[[APPEAL_DEADLINE]]").join(letterDate(deadlineDate));
  const leftover = filled.match(/\[\[[A-Z_]+\]\]/);
  if (leftover) throw new Error(`Letter has an unknown token ${leftover[0]}`);
  return filled;
}

// ================================================================ precedents

export interface PrecedentGroupPlan {
  payerId: PayerId;
  category: DenialCategory;
  count: number;
  overturned: number;
  items: { id: string; condition: Condition; outcome: PrecedentOutcome; rootCause: RootCause; evidence: string[] }[];
}

/**
 * Pick 4 to 6 precedents with an overturn share closest to WIN_RATE, keeping
 * the share on the same side of the payer-history warning threshold. Ties go
 * to the larger group.
 */
export function precedentCounts(rate: number): { count: number; overturned: number } {
  const wantBelow = rate < PAYER_HISTORY_WARN_THRESHOLD;
  let best: { count: number; overturned: number; distance: number } | undefined;
  for (const count of [4, 5, 6]) {
    const overturned = Math.round(rate * count);
    const share = overturned / count;
    if (share < PAYER_HISTORY_WARN_THRESHOLD !== wantBelow) continue;
    const distance = Math.abs(share - rate);
    if (!best || distance < best.distance - 1e-9 || Math.abs(distance - best.distance) < 1e-9) {
      best = { count, overturned, distance };
    }
  }
  if (!best) throw new Error(`No precedent count in 4 to 6 fits win rate ${rate}`);
  return { count: best.count, overturned: best.overturned };
}

/** Deterministic plan for every precedent: IDs, conditions, outcomes, and evidence themes. */
export function precedentPlan(): PrecedentGroupPlan[] {
  const groups: PrecedentGroupPlan[] = [];
  let counter = 0;
  PAYER_IDS.forEach((payerId, p) => {
    DENIAL_CATEGORIES.forEach((category, c) => {
      const rng = createRng(9000 + p * 10 + c);
      const { count, overturned } = precedentCounts(WIN_RATE[payerId][category]);
      const outcomes = rng.shuffle<PrecedentOutcome>([
        ...Array<PrecedentOutcome>(overturned).fill("overturned"),
        ...Array<PrecedentOutcome>(count - overturned).fill("upheld"),
      ]);
      const rootCauses: readonly RootCause[] =
        category === "medical_necessity"
          ? ["severity_not_documented", "criteria_not_met_at_admission", "treatment_appropriate_at_lower_level"]
          : ["treatment_appropriate_at_lower_level", "los_exceeds_expected", "criteria_not_met_at_admission"];

      const items = outcomes.map((outcome, i) => {
        const condition = CONDITIONS[(i + p + c) % CONDITIONS.length];
        const themes = rng.shuffle(CATALOG[condition]).slice(0, outcome === "overturned" ? 2 : 1);
        counter += 1;
        return {
          id: `P${counter}`,
          condition,
          outcome,
          rootCause: rng.pick(rootCauses),
          evidence: themes.map((t) => t.evidenceNeeded),
        };
      });
      groups.push({ payerId, category, count, overturned, items });
    });
  });
  return groups;
}

/** Shape only. Count and length rules live in checkPrecedents(). */
export const PrecedentOutputSchema = z.object({
  precedents: z.array(
    z.object({
      summary: z.string(),
      letter_excerpt: z.string(),
    }),
  ),
});
export type PrecedentOutput = z.infer<typeof PrecedentOutputSchema>;

export interface PrecedentRecord {
  id: string;
  payerId: PayerId;
  category: DenialCategory;
  condition: Condition;
  outcome: PrecedentOutcome;
  summary: string;
  letterExcerpt: string;
}

export interface PrecedentGroupArtifact {
  payerId: PayerId;
  category: DenialCategory;
  promptVersion: string;
  model: string;
  inputHash: string;
  generatedAt: string;
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  precedents: PrecedentRecord[];
}

function precedentGroupPath(group: Pick<PrecedentGroupPlan, "payerId" | "category">): string {
  return `precedents/${group.payerId}-${group.category}.json`;
}

export function renderPrecedentPrompt(
  group: PrecedentGroupPlan,
  criteria: CriteriaArtifact,
): { system: string; user: string } {
  const v = PRECEDENT_PROMPT_VERSION.split(".")[1];
  const payer = criteria.payers.find((x) => x.id === group.payerId)!;
  const items = group.items
    .map((item, i) => {
      const evidenceLine =
        item.outcome === "overturned"
          ? `The appeal documented: ${item.evidence.join("; and ")}`
          : `The appeal could not supply: ${item.evidence[0]}`;
      return [
        `Item ${i + 1}`,
        `Condition: ${CONDITION_LABEL[item.condition]}`,
        `Payer's denial rationale: ${ROOT_CAUSE_STATEMENT[item.rootCause]}`,
        evidenceLine,
        `Outcome: ${item.outcome}`,
      ].join("\n");
    })
    .join("\n\n");
  return {
    system: loadPrompt(`precedent-system.${v}.md`),
    user: renderTemplate(loadPrompt(`precedent-user.${v}.md`), {
      payer_name: payer.name,
      category_label: CATEGORY_LABEL[group.category],
      count: group.count,
      items,
    }),
  };
}

export function checkPrecedents(output: PrecedentOutput, group: PrecedentGroupPlan): string | null {
  const problems: string[] = [];
  if (output.precedents.length !== group.count) {
    problems.push(`expected ${group.count} entries, got ${output.precedents.length}`);
  }
  output.precedents.forEach((entry, i) => {
    const item = group.items[i];
    if (!item) return;
    const label = `entry ${i + 1}`;
    const other = item.outcome === "overturned" ? "upheld" : "overturned";
    if (!new RegExp(`\\b${item.outcome}\\b`, "i").test(entry.summary)) {
      problems.push(`${label} summary must say "${item.outcome}"`);
    }
    if (new RegExp(`\\b${other}\\b`, "i").test(entry.summary)) {
      problems.push(`${label} summary says "${other}" but the outcome is ${item.outcome}`);
    }
    for (const [field, text] of [
      ["summary", entry.summary],
      ["letter_excerpt", entry.letter_excerpt],
    ] as const) {
      const dated = text.match(CALENDAR_DATE);
      if (dated) problems.push(`${label} ${field} contains a date or year: "${dated[0]}"`);
      const named = text.match(PERSON_NAME);
      if (named) problems.push(`${label} ${field} contains a person's name: "${named[0]}"`);
    }
    const sw = words(entry.summary);
    if (sw < 20 || sw > 100) problems.push(`${label} summary is ${sw} words; expected 30 to 80`);
    const ew = words(entry.letter_excerpt);
    if (ew < 45 || ew > 200) problems.push(`${label} letter_excerpt is ${ew} words; expected 60 to 160`);
  });
  return problems.length > 0 ? problems.join("; ") : null;
}

export function precedentInputHash(group: PrecedentGroupPlan): string {
  return sha256(JSON.stringify(group));
}

export async function generatePrecedentGroup(
  group: PrecedentGroupPlan,
  criteria: CriteriaArtifact,
): Promise<PrecedentGroupArtifact> {
  const { system, user } = renderPrecedentPrompt(group, criteria);
  const result = await generateStructured({
    label: `precedents:${group.payerId}:${group.category}`,
    model: SEED_MODEL,
    system,
    prompt: user,
    schema: PrecedentOutputSchema,
    maxTokens: 16000,
    effort: "medium",
    normalize: (o) => ({
      precedents: o.precedents.map((e) => ({
        summary: normalizeDashes(e.summary).trim(),
        letter_excerpt: normalizeDashes(e.letter_excerpt).trim(),
      })),
    }),
    check: (o) => checkPrecedents(o, group),
  });
  return {
    payerId: group.payerId,
    category: group.category,
    promptVersion: PRECEDENT_PROMPT_VERSION,
    model: result.servedModel,
    inputHash: precedentInputHash(group),
    generatedAt: new Date().toISOString(),
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: Number(result.costUsd.toFixed(6)),
    precedents: group.items.map((item, i) => ({
      id: item.id,
      payerId: group.payerId,
      category: group.category,
      condition: item.condition,
      outcome: item.outcome,
      summary: result.data.precedents[i].summary,
      letterExcerpt: result.data.precedents[i].letter_excerpt,
    })),
  };
}

// =================================================================== runner

export interface PassDOptions {
  generate: boolean;
  regenerate: ReadonlySet<string> | "all";
  concurrency: number;
}

export interface PassDResult {
  letters: Map<string, LetterArtifact>;
  precedents: PrecedentRecord[];
  generated: string[];
  costUsd: number;
}

function letterPath(denialId: string): string {
  return `letters/${denialId}.json`;
}

/** Reasons a committed letter cannot be used as is, or null when it is current and passes checks. */
function letterProblem(seed: CaseSeed, criteria: CriteriaArtifact): string | null {
  if (!artifactExists(letterPath(seed.denialId))) return "missing";
  const letter = readArtifact<LetterArtifact>(letterPath(seed.denialId))!;
  if (letter.inputHash !== letterInputHash(letterInputs(seed, criteria))) return "stale";
  const problem = checkLetter({ letter_text: letter.letterTemplate }, seed, criteria);
  return problem ? `failed_checks: ${problem}` : null;
}

function precedentProblem(group: PrecedentGroupPlan): string | null {
  if (!artifactExists(precedentGroupPath(group))) return "missing";
  const artifact = readArtifact<PrecedentGroupArtifact>(precedentGroupPath(group))!;
  if (artifact.inputHash !== precedentInputHash(group)) return "stale";
  const problem = checkPrecedents(
    {
      precedents: artifact.precedents.map((p) => ({ summary: p.summary, letter_excerpt: p.letterExcerpt })),
    },
    group,
  );
  return problem ? `failed_checks: ${problem}` : null;
}

type Job =
  | { kind: "letter"; id: string; seed: CaseSeed; reason: string }
  | { kind: "precedents"; id: string; group: PrecedentGroupPlan; reason: string };

export async function runPassD(
  cases: CaseSeed[],
  criteria: CriteriaArtifact,
  options: PassDOptions,
): Promise<PassDResult> {
  const forced = (id: string) => options.regenerate === "all" || options.regenerate.has(id);
  const jobs: Job[] = [];

  for (const seed of cases) {
    const problem = letterProblem(seed, criteria);
    if (problem || forced(seed.denialId)) {
      jobs.push({ kind: "letter", id: seed.denialId, seed, reason: problem ?? "regenerate requested" });
    }
  }
  const plan = precedentPlan();
  for (const group of plan) {
    const id = `precedents:${group.payerId}:${group.category}`;
    const problem = precedentProblem(group);
    // Precedents regenerate only on "all", not on a case ID list.
    if (problem || options.regenerate === "all") {
      jobs.push({ kind: "precedents", id, group, reason: problem ?? "regenerate requested" });
    }
  }

  if (jobs.length > 0 && !options.generate) {
    const list = jobs.map((j) => `  ${j.id}: ${j.reason}`).join("\n");
    throw new Error(
      `${jobs.length} pass D artifact(s) need generation, which calls the Anthropic API:\n${list}\n` +
        `Rerun with --generate to create them.`,
    );
  }

  let costUsd = 0;
  const generated: string[] = [];
  if (jobs.length > 0) {
    console.log(`Pass D: generating ${jobs.length} artifact(s) with ${SEED_MODEL}, concurrency ${options.concurrency}`);
    const outcomes = await mapPool(jobs, options.concurrency, async (job) => {
      const started = Date.now();
      const artifact =
        job.kind === "letter"
          ? await generateLetter(job.seed, criteria)
          : await generatePrecedentGroup(job.group, criteria);
      writeArtifact(job.kind === "letter" ? letterPath(job.id) : precedentGroupPath(job.group), artifact);
      console.log(
        `  ${job.id.padEnd(36)} ok  attempts ${artifact.attempts}  $${artifact.costUsd.toFixed(3)}  ` +
          `${((Date.now() - started) / 1000).toFixed(0)}s`,
      );
      return artifact.costUsd;
    });
    const failures: string[] = [];
    outcomes.forEach((o, i) => {
      if (o.status === "fulfilled") {
        costUsd += o.value;
        generated.push(jobs[i].id);
      } else {
        const message = o.reason instanceof Error ? o.reason.message : String(o.reason);
        console.error(`  ${jobs[i].id} FAILED  ${message.slice(0, 300)}`);
        failures.push(jobs[i].id);
      }
    });
    if (failures.length > 0) {
      throw new Error(
        `Pass D: ${failures.length} artifact(s) failed: ${failures.join(", ")}. ` +
          `${generated.length} succeeded and were saved; rerun with --generate to retry the rest.`,
      );
    }
  }

  const letters = new Map<string, LetterArtifact>();
  for (const seed of cases) {
    const problem = letterProblem(seed, criteria);
    if (problem) throw new Error(`Letter for ${seed.denialId} is not usable after generation: ${problem}`);
    letters.set(seed.denialId, readArtifact<LetterArtifact>(letterPath(seed.denialId))!);
  }
  const precedents = plan.flatMap((group) => {
    const problem = precedentProblem(group);
    if (problem) throw new Error(`Precedents ${group.payerId}:${group.category} not usable: ${problem}`);
    return readArtifact<PrecedentGroupArtifact>(precedentGroupPath(group))!.precedents;
  });

  return { letters, precedents, generated, costUsd };
}

/** Deadline in days for a case's payer, for filling letter tokens. */
export function letterDeadline(seed: CaseSeed, criteria: CriteriaArtifact): number {
  return deadlineDays(criteria, seed.payerId);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed/pass-d-letters.ts")) {
  const main = async (): Promise<void> => {
    await import("./load-env");
    const { buildCriteria } = await import("./pass-a-criteria");
    const { buildCaseSeeds } = await import("./pass-b-cases");
    const criteria = buildCriteria();

    const caseIndex = process.argv.indexOf("--case");
    const groupIndex = process.argv.indexOf("--precedents");
    if (caseIndex > -1) {
      const id = process.argv[caseIndex + 1];
      const seed = buildCaseSeeds(criteria).cases.find((c) => c.denialId === id);
      if (!seed) throw new Error(`No case ${id}`);
      if (process.argv.includes("--print-prompt")) {
        const { system, user } = renderLetterPrompt(letterInputs(seed, criteria));
        console.log(`--- system ---\n${system}\n--- user ---\n${user}`);
        return;
      }
      const letter = await generateLetter(seed, criteria);
      writeArtifact(letterPath(id), letter);
      console.log(letter.letterTemplate);
      console.log(`\ncited ${letter.citedCodes.join(", ")}; attempts ${letter.attempts}; $${letter.costUsd}`);
    } else if (groupIndex > -1) {
      const [payerId, category] = process.argv[groupIndex + 1].split(":");
      const group = precedentPlan().find((g) => g.payerId === payerId && g.category === category);
      if (!group) throw new Error(`No precedent group ${process.argv[groupIndex + 1]}`);
      const artifact = await generatePrecedentGroup(group, criteria);
      writeArtifact(precedentGroupPath(group), artifact);
      for (const p of artifact.precedents) console.log(`\n${p.id} ${p.condition} ${p.outcome}\n${p.summary}`);
      console.log(`\nattempts ${artifact.attempts}; $${artifact.costUsd}`);
    } else {
      for (const g of precedentPlan()) {
        const rate = WIN_RATE[g.payerId][g.category];
        console.log(
          `${g.payerId.padEnd(10)} ${g.category.padEnd(18)} WIN_RATE ${rate.toFixed(2)}  ` +
            `precedents ${g.overturned}/${g.count} = ${(g.overturned / g.count).toFixed(2)}`,
        );
      }
    }
  };
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
