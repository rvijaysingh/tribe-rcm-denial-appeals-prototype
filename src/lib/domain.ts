/**
 * Shared domain enums.
 *
 * These literal arrays are the single source of truth for the values used by
 * both the Drizzle pgEnums in src/lib/db/schema.ts and the business logic in
 * economics.ts and the pipeline. Defining them here keeps the database enum
 * and the TypeScript union from drifting apart.
 */

/** The two inpatient clinical denial categories in scope (PRD 5). */
export const DENIAL_CATEGORIES = ["medical_necessity", "level_of_care"] as const;
export type DenialCategory = (typeof DENIAL_CATEGORIES)[number];

/** The four clinical conditions in scope (PRD 5). */
export const CONDITIONS = ["chf_exacerbation", "sepsis", "copd_exacerbation", "pneumonia"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Synthetic payers (PRD 8.1). No real payer names anywhere. */
export const PAYER_IDS = ["meridian", "cascade", "northgate"] as const;
export type PayerId = (typeof PAYER_IDS)[number];

/** Criteria style label. Synthetic content only, never real proprietary text. */
export const CRITERIA_STYLES = ["interqual_style", "mcg_style"] as const;
export type CriteriaStyle = (typeof CRITERIA_STYLES)[number];

/** Four terminal routes (PRD 7 stage E). "do_not_appeal" comes from stage A only. */
export const ROUTES = ["ready", "needs_review", "needs_docs", "do_not_appeal"] as const;
export type Route = (typeof ROUTES)[number];

/**
 * Root causes the payer may assert, scoped per category (PRD 7 stage B).
 * Stage B output is validated against the set for the classified category.
 */
export const ROOT_CAUSES_BY_CATEGORY = {
  medical_necessity: [
    "severity_not_documented",
    "criteria_not_met_at_admission",
    "treatment_appropriate_at_lower_level",
  ],
  level_of_care: [
    "treatment_appropriate_at_lower_level",
    "los_exceeds_expected",
    "criteria_not_met_at_admission",
  ],
} as const satisfies Record<DenialCategory, readonly string[]>;

export const ROOT_CAUSES = [
  "severity_not_documented",
  "criteria_not_met_at_admission",
  "treatment_appropriate_at_lower_level",
  "los_exceeds_expected",
] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];

/** True when the root cause is valid for the category the model assigned. */
export function isRootCauseValidForCategory(category: DenialCategory, rootCause: string): boolean {
  return (ROOT_CAUSES_BY_CATEGORY[category] as readonly string[]).includes(rootCause);
}

/** Dataset split. Fixed at seed time; demo never enters an eval (PRD 8.2). */
export const SPLITS = ["dev", "test", "demo"] as const;
export type Split = (typeof SPLITS)[number];

/** Chart document types (PRD 8.1). */
export const DOC_TYPES = ["hp", "progress", "discharge"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Letter sections, fixed per PRD 7 stage D. */
export const SECTION_NAMES = [
  "intro",
  "clinical_summary",
  "criteria_argument",
  "precedent",
  "request",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

/** Pipeline stages, in execution order. */
export const STAGES = ["a_triage", "b_classify", "c_retrieve", "d_draft", "e_verify"] as const;
export type Stage = (typeof STAGES)[number];

export const RUN_STATUSES = ["running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const REVIEW_ACTIONS = ["approve", "edit", "escalate"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const PRECEDENT_OUTCOMES = ["overturned", "upheld"] as const;
export type PrecedentOutcome = (typeof PRECEDENT_OUTCOMES)[number];

/** Clause support status in the evidence matrix (PRD 6.3). */
export const CLAUSE_SUPPORT = ["supported", "weak", "unsupported"] as const;
export type ClauseSupport = (typeof CLAUSE_SUPPORT)[number];
