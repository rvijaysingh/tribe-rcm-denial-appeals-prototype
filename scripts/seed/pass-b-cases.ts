/**
 * Pass B: case seeds.
 *
 * Deterministic, no LLM (PRD 8.2). Produces 43 structured case seeds:
 * - 4 demo cases exactly as specified in PRD 8.3
 * - 3 pre-triaged do-not-appeal queue rows, split = demo
 * - 36 generated cases: 16 dev, 20 test
 *
 * A seed records which clauses the chart will support strongly, weakly, or
 * not at all, plus the triage inputs. Everything downstream derives from it:
 * pass C writes charts from the facts, pass D writes letters, and pass E
 * derives ground truth and asserts it matches `intendedRoute`.
 *
 * Dates are stored as day offsets, not absolute dates, so days-left is correct
 * relative to whenever the seed is loaded.
 *
 * Run standalone: npx tsx scripts/seed/pass-b-cases.ts
 */

import {
  ROOT_CAUSES_BY_CATEGORY,
  type Condition,
  type DenialCategory,
  type PayerId,
  type RootCause,
  type Route,
  type Split,
} from "../../src/lib/domain";
import {
  COST_PER_APPEAL_AI,
  COST_PER_APPEAL_MANUAL,
  OLD_CAPACITY_CUTOFF,
  isAppealableCategory,
  winRate,
} from "../../src/lib/economics";
import { expectedValueCents, toCents } from "../../src/lib/money";
import { buildCriteria, type ClauseRecord, type CriteriaArtifact } from "./pass-a-criteria";
import { createRng, type Rng } from "./rng";

/** Fixed seed. Changing it regenerates the whole case set and invalidates passes C to E. */
export const CASE_SEED = 20260916;

/**
 * strong / weak: documented in the chart.
 * unmet: a required clause with no chart support (drives needs_docs).
 * absent: a non-required clause with no chart support.
 */
export type Support = "strong" | "weak" | "unmet" | "absent";

export type TriageIntent = "appeal" | "expired" | "below_ev" | "ineligible_category" | "account_flagged";

export interface CaseClause {
  clauseId: string;
  code: string;
  key: string;
  required: boolean;
  omittable: boolean;
  support: Support;
}

export interface CaseSeed {
  denialId: string;
  accountId: string;
  split: Split;
  payerId: PayerId;
  condition: Condition;
  category: DenialCategory;
  rootCause: RootCause;
  /** Whole US dollars. */
  amount: number;
  daysSinceReceived: number;
  /** Days between discharge and the denial arriving. */
  dischargeToDenialDays: number;
  /** Account-level flag. False means flagged non-appealable outright. */
  eligible: boolean;
  triage: TriageIntent;
  intendedRoute: Route;
  patient: { age: number; sex: "F" | "M"; losDays: number; drg: string; mrn: string };
  carc: string;
  rarc: string;
  clauses: CaseClause[];
  /** Pre-triaged queue rows get a short chart (PRD 8.2). */
  shortChart: boolean;
  /** Why this case exists, for demo cases. */
  purpose?: string;
}

export interface CasesArtifact {
  seed: number;
  cases: CaseSeed[];
}

const DRGS: Record<Condition, string[]> = {
  chf_exacerbation: ["291", "292", "293"],
  sepsis: ["871", "872"],
  copd_exacerbation: ["190", "191", "192"],
  pneumonia: ["193", "194", "195"],
};

/** Group code CO with CARC 50. RARC differs by category. Codes are quoted, never defined, in letters. */
const CODES: Record<DenialCategory, { carc: string; rarc: string }> = {
  medical_necessity: { carc: "CO-50", rarc: "N115" },
  level_of_care: { carc: "CO-50", rarc: "N130" },
};

/** Minimum days left on appealable generated cases, so a few weeks without a reseed cannot expire them. */
export const MIN_DAYS_LEFT_MARGIN = 21;

// ---------------------------------------------------------------- derivations

export function deadlineDays(criteria: CriteriaArtifact, payerId: PayerId): number {
  const payer = criteria.payers.find((p) => p.id === payerId);
  if (!payer) throw new Error(`Unknown payer ${payerId}`);
  return payer.deadlineDays;
}

export function clausesFor(criteria: CriteriaArtifact, payerId: PayerId, condition: Condition): ClauseRecord[] {
  return criteria.clauses.filter((c) => c.payerId === payerId && c.condition === condition);
}

/** Route implied by triage and clause support. The same rule pass E applies to build ground truth. */
export function routeFromSupport(triage: TriageIntent, clauses: readonly Pick<CaseClause, "required" | "support">[]): Route {
  if (triage !== "appeal") return "do_not_appeal";
  const required = clauses.filter((c) => c.required);
  if (required.some((c) => c.support === "unmet")) return "needs_docs";
  if (required.some((c) => c.support === "weak")) return "needs_review";
  return "ready";
}

/** Triage outcome recomputed from the raw inputs with economics.ts. Independent of the stored intent. */
export function triageFromInputs(
  seed: Pick<CaseSeed, "eligible" | "payerId" | "category" | "daysSinceReceived" | "amount">,
  criteria: CriteriaArtifact,
): TriageIntent {
  const daysLeft = deadlineDays(criteria, seed.payerId) - seed.daysSinceReceived;
  if (!seed.eligible) return "account_flagged";
  if (!isAppealableCategory(seed.payerId, seed.category)) return "ineligible_category";
  if (daysLeft <= 0) return "expired";
  // Cents, so this agrees with stage A exactly at the threshold.
  const evCents = expectedValueCents(toCents(seed.amount), winRate(seed.payerId, seed.category));
  if (evCents <= toCents(COST_PER_APPEAL_AI)) return "below_ev";
  return "appeal";
}

// ------------------------------------------------------------- clause profiles

type ClinicalProfile = "ready" | "needs_review" | "needs_docs";

/** Assign support levels to a payer set for a clinical profile. */
function assignSupport(rng: Rng, set: ClauseRecord[], profile: ClinicalProfile): CaseClause[] {
  const required = set.filter((c) => c.required);
  let weakRequired: string | undefined;
  let unmetRequired: string | undefined;

  if (profile === "needs_review") {
    weakRequired = rng.pick(required).id;
  }
  if (profile === "needs_docs") {
    unmetRequired = rng.pick(required.filter((c) => c.omittable)).id;
    // Some docs cases also carry a weak required clause; the route is still needs_docs.
    const others = required.filter((c) => c.id !== unmetRequired);
    if (others.length > 0 && rng.chance(0.3)) weakRequired = rng.pick(others).id;
  }

  return set.map((c): CaseClause => {
    let support: Support;
    if (c.required) {
      support = c.id === unmetRequired ? "unmet" : c.id === weakRequired ? "weak" : "strong";
    } else if (profile === "ready") {
      // Ready cases carry no weak evidence at all, so a faithful draft has nothing to flag.
      support = c.omittable && rng.chance(0.3) ? "absent" : "strong";
    } else if (c.omittable) {
      const roll = rng.next();
      support = roll < 0.45 ? "strong" : roll < 0.7 ? "weak" : "absent";
    } else {
      support = rng.chance(0.65) ? "strong" : "weak";
    }
    return { clauseId: c.id, code: c.code, key: c.key, required: c.required, omittable: c.omittable, support };
  });
}

/** Explicit support map for demo cases, keyed by catalog key. Every clause in the set must be listed. */
function explicitSupport(set: ClauseRecord[], supportByKey: Record<string, Support>): CaseClause[] {
  const listed = new Set(Object.keys(supportByKey));
  const inSet = new Set(set.map((c) => c.key));
  const missing = [...inSet].filter((k) => !listed.has(k));
  const extra = [...listed].filter((k) => !inSet.has(k));
  if (missing.length || extra.length) {
    throw new Error(`Demo support map mismatch. missing: [${missing}] extra: [${extra}]`);
  }
  return set.map((c) => ({
    clauseId: c.id,
    code: c.code,
    key: c.key,
    required: c.required,
    omittable: c.omittable,
    support: supportByKey[c.key],
  }));
}

// ------------------------------------------------------------------ demo cases

interface FixedCaseSpec {
  denialId: string;
  payerId: PayerId;
  condition: Condition;
  category: DenialCategory;
  rootCause: RootCause;
  amount: number;
  daysSinceReceived: number;
  eligible: boolean;
  patient: { age: number; sex: "F" | "M"; losDays: number; drg: string };
  support: Record<string, Support>;
  shortChart: boolean;
  purpose: string;
}

/** PRD 8.3: the four demo cases and the three pre-triaged do-not-appeal rows. */
const FIXED_CASES: FixedCaseSpec[] = [
  {
    denialId: "DEMO-01",
    payerId: "pinnacle",
    condition: "chf_exacerbation",
    category: "medical_necessity",
    rootCause: "severity_not_documented",
    amount: 18500,
    daysSinceReceived: 139, // 180-day window, 41 days left
    eligible: true,
    patient: { age: 71, sex: "F", losDays: 5, drg: "291" },
    support: {
      hypoxia: "strong",
      iv_diuretic: "strong",
      failed_outpatient: "strong",
      renal: "strong",
      bnp: "strong",
      pulm_edema_imaging: "strong",
      resp_distress: "strong",
      telemetry_arrhythmia: "absent",
    },
    shortChart: false,
    purpose: "Clean end-to-end run, live with streaming. Expected route: ready.",
  },
  {
    denialId: "DEMO-02",
    payerId: "cascade",
    condition: "copd_exacerbation",
    category: "level_of_care",
    rootCause: "treatment_appropriate_at_lower_level",
    amount: 2400,
    daysSinceReceived: 60, // 120-day window, 60 days left
    eligible: true,
    patient: { age: 66, sex: "M", losDays: 3, drg: "191" },
    support: {
      hypoxia_hypercapnia: "strong",
      accessory_muscles: "strong",
      abg_acidosis: "strong",
      failed_ed_treatment: "strong",
      steroid_iv: "strong",
      niv: "strong",
      home_oxygen_escalation: "absent",
    },
    shortChart: false,
    purpose:
      "Threshold story: under the old $5K capacity cutoff this denial was never worked. Expected route: ready.",
  },
  {
    denialId: "DEMO-03",
    payerId: "northgate",
    condition: "sepsis",
    category: "medical_necessity",
    rootCause: "criteria_not_met_at_admission",
    amount: 22000,
    daysSinceReceived: 52, // 90-day window, 38 days left
    eligible: true,
    patient: { age: 68, sex: "F", losDays: 6, drg: "871" },
    support: {
      lactate_repeat_vitals: "unmet",
      source_infection: "strong",
      organ_dysfunction: "strong",
      vasopressor: "strong",
      hypotension_map: "strong",
      iv_antibiotics: "strong",
      sirs_fever_wbc: "strong",
      mental_status: "absent",
      resp_failure: "strong",
    },
    shortChart: false,
    purpose:
      "Chart lacks the lactate value and repeat vitals the required clause needs. Expected route: needs docs.",
  },
  {
    denialId: "DEMO-04",
    payerId: "pinnacle",
    condition: "pneumonia",
    category: "medical_necessity",
    rootCause: "severity_not_documented",
    amount: 9800,
    daysSinceReceived: 85, // 180-day window, 95 days left
    eligible: true,
    // Age 65+ so CURB-65 of 3 is consistent with BUN, respiratory rate and age.
    patient: { age: 74, sex: "M", losDays: 4, drg: "194" },
    support: {
      curb65: "strong",
      hypoxia: "weak",
      imaging_multilobar: "strong",
      labs_bun: "strong",
      confusion: "absent",
      hemodynamic: "absent",
      failed_oral_antibiotics: "absent",
      resp_rate: "strong",
      iv_antibiotic_need: "strong",
    },
    shortChart: false,
    purpose: "One assertion rests on a weak inference that the judge flags. Expected route: needs review.",
  },
  {
    denialId: "DNA-01",
    payerId: "pinnacle",
    condition: "chf_exacerbation",
    category: "level_of_care",
    rootCause: "treatment_appropriate_at_lower_level",
    amount: 12400,
    daysSinceReceived: 184, // day 184 of a 180-day window
    eligible: true,
    patient: { age: 79, sex: "M", losDays: 3, drg: "292" },
    support: {
      hypoxia: "strong",
      iv_diuretic: "strong",
      failed_outpatient: "strong",
      renal: "strong",
      bnp: "strong",
      pulm_edema_imaging: "absent",
      resp_distress: "strong",
      telemetry_arrhythmia: "absent",
    },
    shortChart: true,
    purpose: "Pre-triaged do not appeal: expired window, day 184 of 180. Clinically winnable.",
  },
  {
    denialId: "DNA-02",
    payerId: "northgate",
    condition: "copd_exacerbation",
    category: "medical_necessity",
    rootCause: "severity_not_documented",
    amount: 700, // EV = 700 x 0.38 = 266, under the 275 threshold
    daysSinceReceived: 30,
    eligible: true,
    patient: { age: 63, sex: "F", losDays: 2, drg: "192" },
    support: {
      hypoxia_hypercapnia: "weak",
      failed_ed_treatment: "strong",
      mental_status_hypercapnic: "strong",
      niv: "absent",
      accessory_muscles: "weak",
      steroid_iv: "strong",
      comorbidity: "absent",
      abg_acidosis: "strong",
    },
    shortChart: true,
    purpose: "Pre-triaged do not appeal: EV below threshold, $700 at the payer floor P=0.38, EV $266.",
  },
  {
    denialId: "DNA-03",
    payerId: "northgate",
    condition: "pneumonia",
    category: "level_of_care",
    rootCause: "treatment_appropriate_at_lower_level",
    amount: 6200,
    daysSinceReceived: 20,
    eligible: true,
    patient: { age: 57, sex: "F", losDays: 2, drg: "195" },
    support: {
      curb65: "strong",
      hypoxia: "strong",
      hemodynamic: "strong",
      failed_oral_antibiotics: "absent",
      imaging_multilobar: "strong",
      resp_rate: "strong",
      iv_antibiotic_need: "weak",
    },
    shortChart: true,
    purpose: "Pre-triaged do not appeal: Northgate does not accept level of care appeals.",
  },
];

// ------------------------------------------------------------ generated cases

interface Slot {
  split: Exclude<Split, "demo">;
  triage: TriageIntent;
  profile: ClinicalProfile;
}

/**
 * Route mix per split. Do-not-appeal slots fix a clinical profile so the
 * false write-off metric has winnable cases to catch.
 */
function slotPlan(): Slot[] {
  const slots: Slot[] = [];
  const add = (split: Slot["split"], triage: TriageIntent, profile: ClinicalProfile, n: number) => {
    for (let i = 0; i < n; i++) slots.push({ split, triage, profile });
  };
  // test: 20
  add("test", "appeal", "ready", 7);
  add("test", "appeal", "needs_review", 6);
  add("test", "appeal", "needs_docs", 4);
  add("test", "expired", "ready", 1); // winnable, written off
  add("test", "below_ev", "needs_review", 1); // winnable, written off
  add("test", "ineligible_category", "needs_docs", 1); // not winnable
  // dev: 16
  add("dev", "appeal", "ready", 6);
  add("dev", "appeal", "needs_review", 5);
  add("dev", "appeal", "needs_docs", 3);
  add("dev", "account_flagged", "ready", 1);
  add("dev", "below_ev", "needs_docs", 1);
  return slots;
}

function generateCases(rng: Rng, criteria: CriteriaArtifact, usedMrns: Set<string>): CaseSeed[] {
  const payerIds: PayerId[] = ["pinnacle", "cascade", "northgate"];
  const conditions: Condition[] = ["chf_exacerbation", "sepsis", "copd_exacerbation", "pneumonia"];

  // 36 slots over 12 payer x condition combos: three of each, shuffled.
  const combos = rng.shuffle(
    payerIds.flatMap((p) => conditions.flatMap((c) => [0, 1, 2].map(() => ({ payerId: p, condition: c })))),
  );

  // Ineligible-category slots need Northgate, so they draw from the pool first.
  const slots = slotPlan().sort((a, b) =>
    a.triage === "ineligible_category" ? -1 : b.triage === "ineligible_category" ? 1 : 0,
  );

  const out: Omit<CaseSeed, "denialId" | "accountId">[] = [];
  for (const slot of slots) {
    const index = combos.findIndex((c) => slot.triage !== "ineligible_category" || c.payerId === "northgate");
    if (index === -1) throw new Error("No payer/condition combo left for slot");
    const { payerId, condition } = combos.splice(index, 1)[0];

    const category: DenialCategory =
      slot.triage === "ineligible_category"
        ? "level_of_care"
        : !isAppealableCategory(payerId, "level_of_care")
          ? "medical_necessity"
          : rng.chance(0.6)
            ? "medical_necessity"
            : "level_of_care";

    const deadline = deadlineDays(criteria, payerId);
    const p = winRate(payerId, category);

    let amount: number;
    let daysSinceReceived: number;
    let eligible = true;
    switch (slot.triage) {
      case "expired":
        amount = rng.int(3, 40) * 500;
        daysSinceReceived = deadline + rng.int(1, 40);
        break;
      case "below_ev":
        // Largest amount with EV at or under the threshold, with a 10% cushion.
        amount = rng.int(35, Math.floor((0.9 * COST_PER_APPEAL_AI) / p / 10)) * 10;
        daysSinceReceived = rng.int(5, deadline - MIN_DAYS_LEFT_MARGIN);
        break;
      case "account_flagged":
        eligible = false;
        amount = rng.int(4, 40) * 500;
        daysSinceReceived = rng.int(5, deadline - MIN_DAYS_LEFT_MARGIN);
        break;
      default:
        // About a third under the old $5K capacity cutoff, for the threshold story.
        amount = rng.chance(0.35) ? rng.int(18, 49) * 100 : rng.int(11, 96) * 500;
        daysSinceReceived = rng.int(5, deadline - MIN_DAYS_LEFT_MARGIN);
    }

    const set = clausesFor(criteria, payerId, condition);
    const clauses = assignSupport(rng, set, slot.profile);

    out.push({
      split: slot.split,
      payerId,
      condition,
      category,
      rootCause: rng.pick(ROOT_CAUSES_BY_CATEGORY[category]),
      amount,
      daysSinceReceived,
      dischargeToDenialDays: rng.int(7, 21),
      eligible,
      triage: slot.triage,
      intendedRoute: routeFromSupport(slot.triage, clauses),
      patient: {
        age: rng.int(48, 91),
        sex: rng.chance(0.5) ? "F" : "M",
        losDays: rng.int(2, 6),
        drg: rng.pick(DRGS[condition]),
        mrn: uniqueMrn(rng, usedMrns),
      },
      ...CODES[category],
      clauses,
      shortChart: false,
    });
  }

  // Shuffle before numbering so a case ID reveals nothing about its split or route.
  return rng.shuffle(out).map((c, i) => {
    const n = String(i + 1).padStart(3, "0");
    return { denialId: `CASE-${n}`, accountId: `ACC-${n}`, ...c };
  });
}

function uniqueMrn(rng: Rng, used: Set<string>): string {
  for (;;) {
    const mrn = `SYN${rng.int(1000000, 9999999)}`;
    if (!used.has(mrn)) {
      used.add(mrn);
      return mrn;
    }
  }
}

// ----------------------------------------------------------------------- build

export function buildCaseSeeds(criteria: CriteriaArtifact = buildCriteria()): CasesArtifact {
  const rng = createRng(CASE_SEED);
  const usedMrns = new Set<string>();

  const fixed: CaseSeed[] = FIXED_CASES.map((spec) => {
    const set = clausesFor(criteria, spec.payerId, spec.condition);
    const clauses = explicitSupport(set, spec.support);
    const triage = triageFromInputs(spec, criteria);
    return {
      denialId: spec.denialId,
      accountId: `ACC-${spec.denialId}`,
      split: "demo",
      payerId: spec.payerId,
      condition: spec.condition,
      category: spec.category,
      rootCause: spec.rootCause,
      amount: spec.amount,
      daysSinceReceived: spec.daysSinceReceived,
      dischargeToDenialDays: 10,
      eligible: spec.eligible,
      triage,
      intendedRoute: routeFromSupport(triage, clauses),
      patient: { ...spec.patient, mrn: uniqueMrn(rng, usedMrns) },
      ...CODES[spec.category],
      clauses,
      shortChart: spec.shortChart,
      purpose: spec.purpose,
    };
  });

  const artifact: CasesArtifact = {
    seed: CASE_SEED,
    cases: [...fixed, ...generateCases(rng, criteria, usedMrns)],
  };
  assertCaseInvariants(artifact, criteria);
  return artifact;
}

/** PRD 8.2, 8.3 and internal-consistency constraints. Throws listing every violation. */
export function assertCaseInvariants(artifact: CasesArtifact, criteria: CriteriaArtifact): void {
  const problems: string[] = [];
  const { cases } = artifact;
  const byId = new Map(cases.map((c) => [c.denialId, c]));

  // Counts and splits.
  const count = (split: Split) => cases.filter((c) => c.split === split).length;
  if (cases.length !== 43) problems.push(`expected 43 cases, got ${cases.length}`);
  if (count("dev") !== 16) problems.push(`expected 16 dev, got ${count("dev")}`);
  if (count("test") !== 20) problems.push(`expected 20 test, got ${count("test")}`);
  if (count("demo") !== 7) problems.push(`expected 7 demo (4 DEMO + 3 DNA), got ${count("demo")}`);
  if (byId.size !== cases.length) problems.push("duplicate denial IDs");
  if (new Set(cases.map((c) => c.accountId)).size !== cases.length) problems.push("duplicate account IDs");
  if (new Set(cases.map((c) => c.patient.mrn)).size !== cases.length) problems.push("duplicate MRNs");

  // PRD 8.3 demo table. The route here is the one the clause support derives,
  // which is what this pass controls. DEMO-02's clause support is clean, so it
  // derives ready, but its ground truth label is needs_review: a human review
  // corrected it in spot-checks.json because the drafter misattributes the
  // precedent's basis and the judge is right to flag that. Pass E applies the
  // correction; see PRD 8.3.
  const demoTable: [string, PayerId, Condition, number, Route][] = [
    ["DEMO-01", "pinnacle", "chf_exacerbation", 18500, "ready"],
    ["DEMO-02", "cascade", "copd_exacerbation", 2400, "ready"],
    ["DEMO-03", "northgate", "sepsis", 22000, "needs_docs"],
    ["DEMO-04", "pinnacle", "pneumonia", 9800, "needs_review"],
  ];
  for (const [id, payer, condition, amount, route] of demoTable) {
    const c = byId.get(id);
    if (!c) {
      problems.push(`${id} missing`);
      continue;
    }
    if (c.payerId !== payer || c.condition !== condition || c.amount !== amount || c.intendedRoute !== route) {
      problems.push(`${id} does not match PRD 8.3 (${c.payerId}, ${c.condition}, ${c.amount}, ${c.intendedRoute})`);
    }
  }
  const demo01 = byId.get("DEMO-01");
  const demo02 = byId.get("DEMO-02");
  if (demo01 && deadlineDays(criteria, demo01.payerId) - demo01.daysSinceReceived !== 41) {
    problems.push("DEMO-01 must have 41 days left");
  }
  if (demo02) {
    const ev = demo02.amount * winRate(demo02.payerId, demo02.category);
    const workedOld = ev > COST_PER_APPEAL_MANUAL && demo02.amount >= OLD_CAPACITY_CUTOFF;
    if (workedOld) problems.push("DEMO-02 must not have been worked under the old cutoff");
    if (deadlineDays(criteria, demo02.payerId) - demo02.daysSinceReceived !== 60) {
      problems.push("DEMO-02 must have 60 days left");
    }
  }
  const dnaReasons = ["DNA-01", "DNA-02", "DNA-03"].map((id) => byId.get(id)?.triage);
  if (dnaReasons.join(",") !== "expired,below_ev,ineligible_category") {
    problems.push(`DNA rows must be expired, below_ev, ineligible_category; got ${dnaReasons.join(",")}`);
  }
  const dna02 = byId.get("DNA-02");
  if (dna02 && (dna02.amount !== 700 || dna02.amount * winRate(dna02.payerId, dna02.category) >= COST_PER_APPEAL_AI)) {
    problems.push("DNA-02 must be $700 with EV under COST_PER_APPEAL_AI");
  }

  for (const c of cases) {
    const set = clausesFor(criteria, c.payerId, c.condition);
    const daysLeft = deadlineDays(criteria, c.payerId) - c.daysSinceReceived;

    // Clause list must mirror the payer set exactly.
    if (c.clauses.map((x) => x.clauseId).join() !== set.map((x) => x.id).join()) {
      problems.push(`${c.denialId}: clause list does not match payer set`);
    }
    // Triage intent must agree with economics.ts applied to the raw inputs.
    const recomputed = triageFromInputs(c, criteria);
    if (recomputed !== c.triage) problems.push(`${c.denialId}: triage ${c.triage} but inputs give ${recomputed}`);
    if (c.intendedRoute !== routeFromSupport(c.triage, c.clauses)) {
      problems.push(`${c.denialId}: intendedRoute inconsistent with support`);
    }
    if (!(ROOT_CAUSES_BY_CATEGORY[c.category] as readonly string[]).includes(c.rootCause)) {
      problems.push(`${c.denialId}: root cause ${c.rootCause} invalid for ${c.category}`);
    }
    // Support rules.
    for (const x of c.clauses) {
      if (x.support === "unmet" && !x.required) problems.push(`${c.denialId}/${x.code}: unmet on non-required`);
      if (x.support === "absent" && x.required) problems.push(`${c.denialId}/${x.code}: absent on required`);
      if ((x.support === "unmet" || x.support === "absent") && !x.omittable) {
        problems.push(`${c.denialId}/${x.code}: omitted but not omittable`);
      }
    }
    if (c.intendedRoute === "ready" && c.clauses.some((x) => x.support === "weak")) {
      problems.push(`${c.denialId}: ready case has weak evidence`);
    }
    if (c.triage === "appeal" && c.split !== "demo" && daysLeft < MIN_DAYS_LEFT_MARGIN) {
      problems.push(`${c.denialId}: only ${daysLeft} days left, below margin`);
    }
    if (c.shortChart !== c.denialId.startsWith("DNA-")) problems.push(`${c.denialId}: shortChart flag wrong`);
  }

  // Every route in both eval splits.
  const routes: Route[] = ["ready", "needs_review", "needs_docs", "do_not_appeal"];
  for (const split of ["dev", "test"] as const) {
    for (const route of routes) {
      if (!cases.some((c) => c.split === split && c.intendedRoute === route)) {
        problems.push(`${split} split has no ${route} case`);
      }
    }
  }
  // Threshold story needs appealable cases under the old cutoff.
  const appealable = cases.filter((c) => c.split !== "demo" && c.triage === "appeal");
  const underOldCutoff = appealable.filter((c) => c.amount < OLD_CAPACITY_CUTOFF);
  if (underOldCutoff.length < 5) {
    problems.push(`only ${underOldCutoff.length} appealable cases under the old cutoff; need at least 5`);
  }

  if (problems.length > 0) {
    throw new Error(`Pass B invariants failed:\n- ${problems.join("\n- ")}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed/pass-b-cases.ts")) {
  const criteria = buildCriteria();
  const { cases } = buildCaseSeeds(criteria);
  const tally = (split: Split, route: Route) =>
    cases.filter((c) => c.split === split && c.intendedRoute === route).length;
  console.log(`cases: ${cases.length}`);
  console.log("split     ready  review  docs  dna");
  for (const split of ["dev", "test", "demo"] as const) {
    console.log(
      `${split.padEnd(8)} ${String(tally(split, "ready")).padStart(6)} ${String(tally(split, "needs_review")).padStart(7)} ` +
        `${String(tally(split, "needs_docs")).padStart(5)} ${String(tally(split, "do_not_appeal")).padStart(4)}`,
    );
  }
  for (const c of cases) {
    const days = deadlineDays(criteria, c.payerId) - c.daysSinceReceived;
    const ev = Math.round(c.amount * winRate(c.payerId, c.category));
    const s = c.clauses.map((x) => `${x.required ? x.code : x.code.toLowerCase()}:${x.support[0]}`).join(" ");
    console.log(
      `${c.denialId.padEnd(9)} ${c.split.padEnd(5)} ${c.payerId.padEnd(9)} ${c.condition.padEnd(18)} ` +
        `${c.category === "medical_necessity" ? "MN " : "LOC"} $${String(c.amount).padStart(6)} EV $${String(ev).padStart(6)} ` +
        `${String(days).padStart(4)}d ${c.triage.padEnd(19)} ${c.intendedRoute.padEnd(13)} ${s}`,
    );
  }
}
