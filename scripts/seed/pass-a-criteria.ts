/**
 * Pass A: payers, criteria sets, criteria clauses, and payer notes.
 *
 * Deterministic. Builds 12 criteria sets (3 payers x 4 conditions) of 6 to 9
 * clauses each, 3 to 4 required, from the hand-written catalog, plus 1 to 2
 * unpublished payer notes per set. Clause IDs (C1, C2, ...) are assigned in a
 * fixed order so they are stable across reseeds and safe to cite.
 *
 * Run standalone: npx tsx scripts/seed/pass-a-criteria.ts
 */

import {
  CONDITIONS,
  PAYER_IDS,
  type Condition,
  type CriteriaStyle,
  type PayerId,
} from "../../src/lib/domain";
import { CONDITION_PREFIX, criterion } from "./catalog";

export interface PayerRecord {
  id: PayerId;
  name: string;
  criteriaStyle: CriteriaStyle;
  deadlineDays: number;
  appealFormatNotes: string;
}

export interface CriteriaSetRecord {
  id: string;
  payerId: PayerId;
  condition: Condition;
  version: string;
}

export interface ClauseRecord {
  /** Citable ID, e.g. "C12". */
  id: string;
  setId: string;
  payerId: PayerId;
  condition: Condition;
  /** Payer-facing code, e.g. "CHF-03". */
  code: string;
  text: string;
  required: boolean;
  /** Catalog key. Seed-only; links the clause to chart facts. Not loaded to the DB. */
  key: string;
  omittable: boolean;
}

export interface PayerNoteRecord {
  id: string;
  payerId: PayerId;
  condition: Condition;
  text: string;
}

export interface CriteriaArtifact {
  payers: PayerRecord[];
  criteriaSets: CriteriaSetRecord[];
  clauses: ClauseRecord[];
  payerNotes: PayerNoteRecord[];
}

/** Synthetic payers (PRD 8.1). Deadlines span the 90 to 180 day range in PRD 2. */
export const PAYERS: PayerRecord[] = [
  {
    id: "pinnacle",
    name: "Pinnacle Health Plan",
    criteriaStyle: "interqual_style",
    deadlineDays: 180,
    appealFormatNotes:
      "Level 1 appeal by letter or portal upload. Cite criteria codes inline. Attach the H&P and progress notes. Five page limit.",
  },
  {
    id: "cascade",
    name: "Cascade Mutual",
    criteriaStyle: "mcg_style",
    deadlineDays: 120,
    appealFormatNotes:
      "Written appeal addressed to Utilization Management. Reference the guideline code and the specific finding for each argument. Include a physician attestation line.",
  },
  {
    id: "northgate",
    name: "Northgate Advantage",
    criteriaStyle: "mcg_style",
    deadlineDays: 90,
    appealFormatNotes:
      "Reconsideration request within the filing window. The clinical rationale must map each finding to a numbered criterion. Level of care denials are not eligible for provider appeal.",
  },
];

const CRITERIA_VERSION = "2026.1";

type SetSpec = { key: string; required?: true }[];

/**
 * Which catalog criteria each payer uses, in clause order, and which are
 * required. Each set has at least one omittable required clause so pass B can
 * build a needs_docs case for it. Northgate sepsis requires
 * lactate_repeat_vitals because DEMO-03 depends on it.
 */
export const SET_SPECS: Record<PayerId, Record<Condition, SetSpec>> = {
  pinnacle: {
    chf_exacerbation: [
      { key: "hypoxia", required: true },
      { key: "iv_diuretic", required: true },
      { key: "failed_outpatient", required: true },
      { key: "renal", required: true },
      { key: "bnp" },
      { key: "pulm_edema_imaging" },
      { key: "resp_distress" },
      { key: "telemetry_arrhythmia" },
    ],
    sepsis: [
      { key: "lactate_repeat_vitals", required: true },
      { key: "hypotension_map", required: true },
      { key: "source_infection", required: true },
      { key: "organ_dysfunction" },
      { key: "iv_antibiotics" },
      { key: "sirs_fever_wbc" },
      { key: "vasopressor" },
    ],
    copd_exacerbation: [
      { key: "hypoxia_hypercapnia", required: true },
      { key: "failed_ed_treatment", required: true },
      { key: "niv", required: true },
      { key: "accessory_muscles" },
      { key: "steroid_iv" },
      { key: "abg_acidosis" },
    ],
    pneumonia: [
      { key: "curb65", required: true },
      { key: "hypoxia", required: true },
      { key: "imaging_multilobar", required: true },
      { key: "labs_bun", required: true },
      { key: "confusion" },
      { key: "hemodynamic" },
      { key: "failed_oral_antibiotics" },
      { key: "resp_rate" },
      { key: "iv_antibiotic_need" },
    ],
  },
  cascade: {
    chf_exacerbation: [
      { key: "hypoxia", required: true },
      { key: "iv_diuretic", required: true },
      { key: "bnp", required: true },
      { key: "resp_distress" },
      { key: "pulm_edema_imaging" },
      { key: "failed_outpatient" },
      { key: "hypotension_perfusion" },
    ],
    sepsis: [
      { key: "hypotension_map", required: true },
      { key: "iv_antibiotics", required: true },
      { key: "organ_dysfunction", required: true },
      { key: "source_infection" },
      { key: "sirs_fever_wbc" },
      { key: "lactate_repeat_vitals" },
      { key: "mental_status" },
      { key: "resp_failure" },
    ],
    copd_exacerbation: [
      { key: "hypoxia_hypercapnia", required: true },
      { key: "accessory_muscles", required: true },
      { key: "abg_acidosis", required: true },
      { key: "failed_ed_treatment", required: true },
      { key: "steroid_iv" },
      { key: "niv" },
      { key: "home_oxygen_escalation" },
    ],
    pneumonia: [
      { key: "hypoxia", required: true },
      { key: "resp_rate", required: true },
      { key: "confusion", required: true },
      { key: "curb65" },
      { key: "imaging_multilobar" },
      { key: "iv_antibiotic_need" },
    ],
  },
  northgate: {
    chf_exacerbation: [
      { key: "iv_diuretic", required: true },
      { key: "failed_outpatient", required: true },
      { key: "pulm_edema_imaging", required: true },
      { key: "hypoxia" },
      { key: "bnp" },
      { key: "renal" },
    ],
    sepsis: [
      { key: "lactate_repeat_vitals", required: true },
      { key: "source_infection", required: true },
      { key: "organ_dysfunction", required: true },
      { key: "vasopressor", required: true },
      { key: "hypotension_map" },
      { key: "iv_antibiotics" },
      { key: "sirs_fever_wbc" },
      { key: "mental_status" },
      { key: "resp_failure" },
    ],
    copd_exacerbation: [
      { key: "hypoxia_hypercapnia", required: true },
      { key: "failed_ed_treatment", required: true },
      { key: "mental_status_hypercapnic", required: true },
      { key: "niv" },
      { key: "accessory_muscles" },
      { key: "steroid_iv" },
      { key: "comorbidity" },
      { key: "abg_acidosis" },
    ],
    pneumonia: [
      { key: "curb65", required: true },
      { key: "hypoxia", required: true },
      { key: "hemodynamic", required: true },
      { key: "failed_oral_antibiotics" },
      { key: "imaging_multilobar" },
      { key: "resp_rate" },
      { key: "iv_antibiotic_need" },
    ],
  },
};

/**
 * Unpublished payer rules: what experienced appeals nurses know that is not
 * written in the criteria set. 1 to 2 per payer and condition.
 */
export const PAYER_NOTE_SPECS: Record<PayerId, Record<Condition, string[]>> = {
  pinnacle: {
    chf_exacerbation: [
      "Reviewers expect oral diuretic failure to be documented with doses and dates for the 72 hours before arrival. A history line saying the patient failed outpatient therapy is not accepted on its own.",
      "Medical directors discount natriuretic peptide values drawn after the first IV diuretic dose.",
    ],
    sepsis: [
      "Reviewers look for the lactate to be repeated within 6 hours. A single elevated value without a trend is frequently challenged.",
    ],
    copd_exacerbation: [
      "Noninvasive ventilation counts toward inpatient severity only when documented as continuous or near continuous for at least 4 hours.",
    ],
    pneumonia: [
      "The severity score must be calculated in the admitting note itself, not reconstructed later in progress notes.",
      "Arguments citing new confusion are stronger when a baseline mental status from family or facility records is documented.",
    ],
  },
  cascade: {
    chf_exacerbation: [
      "Telemetry orders without a documented rhythm concern are a common denial trigger. Include the rhythm finding that prompted monitoring.",
    ],
    sepsis: [
      "Reviewers expect time stamps on antibiotic administration relative to arrival.",
      "Organ dysfunction arguments should compare against a documented baseline creatinine or platelet count when one exists.",
    ],
    copd_exacerbation: [
      "Blood gas results obtained more than 2 hours after BiPAP starts are treated as post-treatment values and not accepted as admission severity.",
    ],
    pneumonia: [
      "Pulse oximetry is accepted only when the reading is documented on room air or the oxygen flow rate is stated.",
    ],
  },
  northgate: {
    chf_exacerbation: [
      "Pulmonary edema must be supported by the radiology report language, not the clinician's reading in the H&P.",
    ],
    sepsis: [
      "Sepsis severity is not considered met without a lactate value and a second full set of vital signs after fluid resuscitation.",
      "Vasopressor arguments must include the start time and the peak dose.",
    ],
    copd_exacerbation: [
      "Hypercapnic somnolence must be tied to a blood gas result from the same time window.",
      "Any oxygen escalation argument must state the home oxygen baseline flow.",
    ],
    pneumonia: [
      "Hypotension is reviewed against the post-bolus reading, not the triage reading.",
    ],
  },
};

/** Build the pass A artifact. Pure and deterministic. Throws on any invariant violation. */
export function buildCriteria(): CriteriaArtifact {
  const criteriaSets: CriteriaSetRecord[] = [];
  const clauses: ClauseRecord[] = [];
  const payerNotes: PayerNoteRecord[] = [];
  let clauseCounter = 0;
  let noteCounter = 0;

  for (const payer of PAYERS) {
    for (const condition of CONDITIONS) {
      const setId = `CS-${payer.id}-${condition}`;
      criteriaSets.push({ id: setId, payerId: payer.id, condition, version: CRITERIA_VERSION });

      const spec = SET_SPECS[payer.id][condition];
      spec.forEach((entry, index) => {
        const c = criterion(condition, entry.key);
        clauseCounter += 1;
        clauses.push({
          id: `C${clauseCounter}`,
          setId,
          payerId: payer.id,
          condition,
          code: `${CONDITION_PREFIX[condition]}-${String(index + 1).padStart(2, "0")}`,
          text: c.clause[payer.criteriaStyle],
          required: entry.required === true,
          key: c.key,
          omittable: c.omittable,
        });
      });

      for (const text of PAYER_NOTE_SPECS[payer.id][condition]) {
        noteCounter += 1;
        payerNotes.push({
          id: `N${noteCounter}`,
          payerId: payer.id,
          condition,
          text,
        });
      }
    }
  }

  const artifact: CriteriaArtifact = { payers: PAYERS, criteriaSets, clauses, payerNotes };
  assertCriteriaInvariants(artifact);
  return artifact;
}

/** PRD 8.2 pass A constraints. Throws with every violation listed. */
export function assertCriteriaInvariants(artifact: CriteriaArtifact): void {
  const problems: string[] = [];

  if (artifact.criteriaSets.length !== PAYER_IDS.length * CONDITIONS.length) {
    problems.push(`expected ${PAYER_IDS.length * CONDITIONS.length} criteria sets, got ${artifact.criteriaSets.length}`);
  }

  for (const set of artifact.criteriaSets) {
    const inSet = artifact.clauses.filter((c) => c.setId === set.id);
    const required = inSet.filter((c) => c.required);
    const keys = new Set(inSet.map((c) => c.key));
    const notes = artifact.payerNotes.filter(
      (n) => n.payerId === set.payerId && n.condition === set.condition,
    );

    if (inSet.length < 6 || inSet.length > 9) problems.push(`${set.id}: ${inSet.length} clauses, need 6 to 9`);
    if (required.length < 3 || required.length > 4) {
      problems.push(`${set.id}: ${required.length} required clauses, need 3 to 4`);
    }
    if (!required.some((c) => c.omittable)) {
      problems.push(`${set.id}: no omittable required clause, so no needs_docs case can be built`);
    }
    if (keys.size !== inSet.length) problems.push(`${set.id}: duplicate catalog key`);
    if (notes.length < 1 || notes.length > 2) problems.push(`${set.id}: ${notes.length} payer notes, need 1 to 2`);
  }

  const ids = artifact.clauses.map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate clause IDs");

  const allText = [
    ...artifact.clauses.map((c) => c.text),
    ...artifact.payerNotes.map((n) => n.text),
    ...artifact.payers.map((p) => p.appealFormatNotes),
  ];
  if (allText.some((t) => t.includes("—"))) problems.push("em dash found in criteria text");

  if (problems.length > 0) {
    throw new Error(`Pass A invariants failed:\n- ${problems.join("\n- ")}`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed/pass-a-criteria.ts")) {
  const artifact = buildCriteria();
  console.log(`payers: ${artifact.payers.length}`);
  console.log(`criteria sets: ${artifact.criteriaSets.length}`);
  console.log(`clauses: ${artifact.clauses.length} (${artifact.clauses.filter((c) => c.required).length} required)`);
  console.log(`payer notes: ${artifact.payerNotes.length}`);
  for (const set of artifact.criteriaSets) {
    const inSet = artifact.clauses.filter((c) => c.setId === set.id);
    const req = inSet.filter((c) => c.required).map((c) => `${c.id}/${c.code}`);
    console.log(`  ${set.id}: ${inSet.length} clauses, required ${req.join(", ")}`);
  }
}
