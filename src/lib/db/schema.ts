/**
 * Drizzle schema for every entity in PRD section 8.1.
 *
 * pgEnums are built from the literal arrays in src/lib/domain.ts so the
 * database and the TypeScript unions cannot drift. Vector columns are
 * vector(1024) to match EMBEDDING_DIM, with HNSW indexes (PRD 8.1).
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIM } from "../models";
import {
  CONDITIONS,
  CRITERIA_STYLES,
  DENIAL_CATEGORIES,
  DOC_TYPES,
  PAYER_IDS,
  PRECEDENT_OUTCOMES,
  REVIEW_ACTIONS,
  ROOT_CAUSES,
  ROUTES,
  RUN_STATUSES,
  SPLITS,
  STAGES,
} from "../domain";

export const payerIdEnum = pgEnum("payer_id", PAYER_IDS);
export const conditionEnum = pgEnum("condition", CONDITIONS);
export const denialCategoryEnum = pgEnum("denial_category", DENIAL_CATEGORIES);
export const criteriaStyleEnum = pgEnum("criteria_style", CRITERIA_STYLES);
export const rootCauseEnum = pgEnum("root_cause", ROOT_CAUSES);
export const routeEnum = pgEnum("route", ROUTES);
export const splitEnum = pgEnum("split", SPLITS);
export const docTypeEnum = pgEnum("doc_type", DOC_TYPES);
export const stageEnum = pgEnum("stage", STAGES);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const reviewActionEnum = pgEnum("review_action", REVIEW_ACTIONS);
export const precedentOutcomeEnum = pgEnum("precedent_outcome", PRECEDENT_OUTCOMES);
// Clause support status lives in stage E's output JSON, not in a column, so it
// needs no pgEnum. CLAUSE_SUPPORT in domain.ts validates it at the zod layer.

/**
 * Money is numeric(12,2), never float. Drizzle returns numeric as a string;
 * callers parse at the edge so cents never round through binary floating point.
 */
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

// ---------------------------------------------------------------- reference

export const payers = pgTable("payers", {
  id: payerIdEnum("id").primaryKey(),
  name: text("name").notNull(),
  criteriaStyle: criteriaStyleEnum("criteria_style").notNull(),
  /** Days from denial receipt to the appeal deadline. */
  deadlineDays: integer("deadline_days").notNull(),
  appealFormatNotes: text("appeal_format_notes").notNull(),
});

export const criteriaSets = pgTable(
  "criteria_sets",
  {
    id: text("id").primaryKey(),
    payerId: payerIdEnum("payer_id")
      .notNull()
      .references(() => payers.id, { onDelete: "cascade" }),
    condition: conditionEnum("condition").notNull(),
    version: text("version").notNull(),
  },
  (t) => [unique("criteria_sets_payer_condition_uq").on(t.payerId, t.condition)],
);

export const criteriaClauses = pgTable(
  "criteria_clauses",
  {
    /** Human-readable, stable across reseeds, e.g. "C12". */
    id: text("id").primaryKey(),
    setId: text("set_id")
      .notNull()
      .references(() => criteriaSets.id, { onDelete: "cascade" }),
    /** Payer-facing clause code, e.g. "CHF-03". */
    code: text("code").notNull(),
    text: text("text").notNull(),
    /** Required clauses are always retrieved in stage C even if they rank low. */
    required: boolean("required").notNull().default(false),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    index("criteria_clauses_set_idx").on(t.setId),
    index("criteria_clauses_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/** The unpublished payer rules that live only in nurse memory (PRD 8.1). */
export const payerNotes = pgTable(
  "payer_notes",
  {
    id: text("id").primaryKey(),
    payerId: payerIdEnum("payer_id")
      .notNull()
      .references(() => payers.id, { onDelete: "cascade" }),
    condition: conditionEnum("condition").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    index("payer_notes_payer_condition_idx").on(t.payerId, t.condition),
    index("payer_notes_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const precedentAppeals = pgTable(
  "precedent_appeals",
  {
    id: text("id").primaryKey(),
    payerId: payerIdEnum("payer_id")
      .notNull()
      .references(() => payers.id, { onDelete: "cascade" }),
    category: denialCategoryEnum("category").notNull(),
    condition: conditionEnum("condition").notNull(),
    summary: text("summary").notNull(),
    outcome: precedentOutcomeEnum("outcome").notNull(),
    letterExcerpt: text("letter_excerpt").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    index("precedent_appeals_filter_idx").on(t.payerId, t.category, t.outcome),
    index("precedent_appeals_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

// -------------------------------------------------------------------- cases

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  /** Synthetic MRN. No real identifiers, no PHI. */
  mrn: text("mrn").notNull(),
  patientAge: integer("patient_age").notNull(),
  admitDate: timestamp("admit_date", { withTimezone: true }).notNull(),
  dischargeDate: timestamp("discharge_date", { withTimezone: true }).notNull(),
  drg: text("drg").notNull(),
  condition: conditionEnum("condition").notNull(),
});

export const denials = pgTable(
  "denials",
  {
    /** e.g. "DEMO-01" or "CASE-017". */
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    payerId: payerIdEnum("payer_id")
      .notNull()
      .references(() => payers.id, { onDelete: "cascade" }),
    category: denialCategoryEnum("category").notNull(),
    amount: money("amount").notNull(),
    receivedDate: timestamp("received_date", { withTimezone: true }).notNull(),
    carc: text("carc").notNull(),
    rarc: text("rarc").notNull(),
    letterText: text("letter_text").notNull(),
    /** False when the account is flagged non-appealable outright. */
    eligible: boolean("eligible").notNull().default(true),
    split: splitEnum("split").notNull(),
  },
  (t) => [index("denials_split_idx").on(t.split), index("denials_payer_idx").on(t.payerId)],
);

export const chartDocs = pgTable(
  "chart_docs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    docType: docTypeEnum("doc_type").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("chart_docs_account_idx").on(t.accountId)],
);

export const chartLines = pgTable(
  "chart_lines",
  {
    /** Cited by the drafter as "L47". Unique across the whole case. */
    id: text("id").primaryKey(),
    docId: text("doc_id")
      .notNull()
      .references(() => chartDocs.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    index("chart_lines_doc_idx").on(t.docId),
    unique("chart_lines_doc_line_uq").on(t.docId, t.lineNo),
  ],
);

/** Labels derived from the case seed in pass E. Never shown to the pipeline. */
export const groundTruth = pgTable("ground_truth", {
  denialId: text("denial_id")
    .primaryKey()
    .references(() => denials.id, { onDelete: "cascade" }),
  category: denialCategoryEnum("category").notNull(),
  rootCause: rootCauseEnum("root_cause").notNull(),
  metClauseIds: jsonb("met_clause_ids").$type<string[]>().notNull(),
  unmetRequiredClauseIds: jsonb("unmet_required_clause_ids").$type<string[]>().notNull(),
  expectedRoute: routeEnum("expected_route").notNull(),
  winnable: boolean("winnable").notNull(),
  approveAsIs: boolean("approve_as_is").notNull(),
  /** True once a human has spot-checked this label (PRD 8.2 pass E). */
  spotChecked: boolean("spot_checked").notNull().default(false),
  spotCheckNote: text("spot_check_note"),
});

// ------------------------------------------------------------------ runtime

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    denialId: text("denial_id")
      .notNull()
      .references(() => denials.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    totalMs: integer("total_ms"),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 }),
    route: routeEnum("route"),
    routeReason: text("route_reason"),
    promptVersion: text("prompt_version").notNull(),
    modelSet: text("model_set").notNull(),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("pipeline_runs_denial_idx").on(t.denialId),
    index("pipeline_runs_status_idx").on(t.status),
  ],
);

export const stageOutputs = pgTable(
  "stage_outputs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stage: stageEnum("stage").notNull(),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    ms: integer("ms").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cost: numeric("cost", { precision: 10, scale: 6 }).notNull().default("0"),
    skipped: boolean("skipped").notNull().default(false),
  },
  (t) => [
    index("stage_outputs_run_idx").on(t.runId),
    unique("stage_outputs_run_stage_uq").on(t.runId, t.stage),
  ],
);

export const reviewerFeedback = pgTable(
  "reviewer_feedback",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    action: reviewActionEnum("action").notNull(),
    editedText: text("edited_text"),
    diffJson: jsonb("diff_json"),
    reason: text("reason"),
    /** Panel-open to action, in minutes. Feeds the reviewer-minutes metric. */
    reviewerMinutes: real("reviewer_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviewer_feedback_run_idx").on(t.runId)],
);

export const evalRuns = pgTable("eval_runs", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  split: splitEnum("split").notNull(),
  caseCount: integer("case_count").notNull(),
  promptVersion: text("prompt_version").notNull(),
  modelSet: text("model_set").notNull(),
  metricsJson: jsonb("metrics_json").notNull(),
  perCaseJson: jsonb("per_case_json").notNull(),
  /**
   * The single Opus run quoted as the prototype's result. Iteration runs on
   * Sonnet stay false and are used only for deltas (PRD 9.3).
   */
  reference: boolean("reference").notNull().default(false),
});
