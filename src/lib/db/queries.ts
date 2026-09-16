/**
 * Typed queries for the pipeline and the UI.
 *
 * The pipeline reads a case through loadPipelineCase, which deliberately does
 * not touch ground_truth. Labels exist only for the eval harness; a pipeline
 * that could read them would score itself.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { lineLabel } from "../citations";
import type { Condition, DenialCategory, DocType, PayerId, RunStatus, Split, Stage } from "../domain";
import { getDb } from "./client";
import {
  accounts,
  chartDocs,
  chartLines,
  criteriaClauses,
  criteriaSets,
  denials,
  payerNotes,
  payers,
  pipelineRuns,
  reviewerFeedback,
  stageOutputs,
} from "./schema";

export interface ChartLineRow {
  /** Database key, e.g. "ACC-DEMO-03-L47". */
  key: string;
  /** Citation label the model sees, e.g. "L47". */
  label: string;
  lineNo: number;
  docType: DocType;
  text: string;
}

export interface PipelineCase {
  denial: {
    id: string;
    accountId: string;
    payerId: PayerId;
    category: DenialCategory;
    /** Postgres numeric string, e.g. "18500.00". Parse with toCents. */
    amount: string;
    receivedDate: Date;
    carc: string;
    rarc: string;
    letterText: string;
    eligible: boolean;
    split: Split;
  };
  account: {
    id: string;
    mrn: string;
    patientAge: number;
    admitDate: Date;
    dischargeDate: Date;
    drg: string;
    condition: Condition;
  };
  payer: {
    id: PayerId;
    name: string;
    criteriaStyle: string;
    deadlineDays: number;
    appealFormatNotes: string;
  };
  /** Ordered by line number, continuous across the case's documents. */
  chart: ChartLineRow[];
  /** Document types present, in order, for prompt headers. */
  docTypes: DocType[];
}

/** Load everything the pipeline may see for one denial. Throws when it does not exist. */
export async function loadPipelineCase(denialId: string): Promise<PipelineCase> {
  const [row] = await getDb()
    .select({ denial: denials, account: accounts, payer: payers })
    .from(denials)
    .innerJoin(accounts, eq(accounts.id, denials.accountId))
    .innerJoin(payers, eq(payers.id, denials.payerId))
    .where(eq(denials.id, denialId));

  if (!row) throw new Error(`No denial ${denialId}. Has the database been seeded?`);

  const lines = await getDb()
    .select({
      key: chartLines.id,
      lineNo: chartLines.lineNo,
      text: chartLines.text,
      docType: chartDocs.docType,
    })
    .from(chartLines)
    .innerJoin(chartDocs, eq(chartDocs.id, chartLines.docId))
    .where(eq(chartDocs.accountId, row.account.id))
    .orderBy(asc(chartLines.lineNo));

  if (lines.length === 0) throw new Error(`Case ${denialId} has no chart lines. Has the database been seeded?`);

  const docTypes: DocType[] = [];
  for (const line of lines) {
    if (docTypes[docTypes.length - 1] !== line.docType) docTypes.push(line.docType);
  }

  return {
    denial: row.denial,
    account: row.account,
    payer: row.payer,
    chart: lines.map((l) => ({ ...l, label: lineLabel(l.lineNo) })),
    docTypes,
  };
}

export interface ClauseCandidate {
  id: string;
  code: string;
  text: string;
  required: boolean;
  /** Cosine similarity in [0, 1]. */
  score: number;
}

/**
 * Clauses for a payer and condition, ranked by cosine similarity to the query
 * vector. The metadata filter runs first, in SQL, so the vector search only
 * ever sees clauses that could legally apply to this case.
 */
export async function searchClauses(
  payerId: PayerId,
  condition: Condition,
  queryVector: number[],
  limit: number,
): Promise<ClauseCandidate[]> {
  const vector = sql`${JSON.stringify(queryVector)}::vector`;
  return getDb()
    .select({
      id: criteriaClauses.id,
      code: criteriaClauses.code,
      text: criteriaClauses.text,
      required: criteriaClauses.required,
      score: sql<number>`1 - (${criteriaClauses.embedding} <=> ${vector})`,
    })
    .from(criteriaClauses)
    .innerJoin(criteriaSets, eq(criteriaSets.id, criteriaClauses.setId))
    .where(and(eq(criteriaSets.payerId, payerId), eq(criteriaSets.condition, condition)))
    .orderBy(sql`${criteriaClauses.embedding} <=> ${vector}`)
    .limit(limit);
}

/** Every clause in the payer's set for a condition, unranked. Used to force required clauses in. */
export async function allClauses(payerId: PayerId, condition: Condition): Promise<Omit<ClauseCandidate, "score">[]> {
  return getDb()
    .select({
      id: criteriaClauses.id,
      code: criteriaClauses.code,
      text: criteriaClauses.text,
      required: criteriaClauses.required,
    })
    .from(criteriaClauses)
    .innerJoin(criteriaSets, eq(criteriaSets.id, criteriaClauses.setId))
    .where(and(eq(criteriaSets.payerId, payerId), eq(criteriaSets.condition, condition)))
    .orderBy(asc(criteriaClauses.code));
}

// A type alias, not an interface: db.execute requires Record<string, unknown>,
// and only type literals get TypeScript's implicit index signature.
export type PrecedentCandidate = {
  id: string;
  summary: string;
  letterExcerpt: string;
  outcome: string;
  condition: Condition;
  score: number;
};

/** Overturned precedents for this payer and category, ranked by similarity. */
export async function searchPrecedents(
  payerId: PayerId,
  category: DenialCategory,
  queryVector: number[],
  limit: number,
): Promise<PrecedentCandidate[]> {
  const vector = sql`${JSON.stringify(queryVector)}::vector`;
  const rows = await getDb().execute<PrecedentCandidate>(sql`
    SELECT id, summary, letter_excerpt AS "letterExcerpt", outcome, condition,
           1 - (embedding <=> ${vector}) AS score
    FROM precedent_appeals
    WHERE payer_id = ${payerId} AND category = ${category} AND outcome = 'overturned'
    ORDER BY embedding <=> ${vector}
    LIMIT ${limit}
  `);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

/** Unpublished payer rules for a payer and condition, shown in the UI. */
export async function getPayerNotes(payerId: PayerId, condition: Condition): Promise<{ id: string; text: string }[]> {
  return getDb()
    .select({ id: payerNotes.id, text: payerNotes.text })
    .from(payerNotes)
    .where(and(eq(payerNotes.payerId, payerId), eq(payerNotes.condition, condition)))
    .orderBy(asc(payerNotes.id));
}

/** Share of this payer and category's precedents that were overturned, for the payer-history flag. */
export async function payerOverturnRate(payerId: PayerId, category: DenialCategory): Promise<number | null> {
  const rows = await getDb().execute<{ overturned: number; total: number }>(sql`
    SELECT count(*) FILTER (WHERE outcome = 'overturned')::int AS overturned, count(*)::int AS total
    FROM precedent_appeals WHERE payer_id = ${payerId} AND category = ${category}
  `);
  const row = rows[0];
  return row && row.total > 0 ? row.overturned / row.total : null;
}

// ------------------------------------------------------------------ workqueue

export type WorkqueueRow = {
  denialId: string;
  accountId: string;
  payerId: PayerId;
  payerName: string;
  deadlineDays: number;
  condition: Condition;
  category: DenialCategory;
  /** Postgres numeric string. */
  amount: string;
  receivedDate: Date;
  eligible: boolean;
  split: Split;
  /** Latest completed run, when there is one. */
  runId: string | null;
  route: string | null;
  totalCost: string | null;
  totalMs: number | null;
  completedAt: Date | null;
  /** Any run at all, including failed and in-flight, for the status column. */
  runStatus: string | null;
};

/**
 * Every denied account for the workqueue, with its latest completed run.
 *
 * Triage is not stored on the row: it is recomputed from the denial by stage A
 * at render time, so a case that has never been run still shows its decision,
 * expected value and days left (PRD 6.1).
 */
export async function loadWorkqueue(): Promise<WorkqueueRow[]> {
  return getDb().execute<WorkqueueRow>(sql`
    SELECT
      d.id                AS "denialId",
      d.account_id        AS "accountId",
      d.payer_id          AS "payerId",
      p.name              AS "payerName",
      p.deadline_days     AS "deadlineDays",
      a.condition         AS "condition",
      d.category          AS "category",
      d.amount            AS "amount",
      d.received_date     AS "receivedDate",
      d.eligible          AS "eligible",
      d.split             AS "split",
      done.id             AS "runId",
      done.route          AS "route",
      done.total_cost     AS "totalCost",
      done.total_ms       AS "totalMs",
      done.completed_at   AS "completedAt",
      latest.status       AS "runStatus"
    FROM denials d
    JOIN accounts a ON a.id = d.account_id
    JOIN payers p ON p.id = d.payer_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.route, r.total_cost, r.total_ms, r.completed_at
      FROM pipeline_runs r
      WHERE r.denial_id = d.id AND r.status = 'completed'
      ORDER BY r.completed_at DESC NULLS LAST
      LIMIT 1
    ) done ON true
    LEFT JOIN LATERAL (
      SELECT r.status
      FROM pipeline_runs r
      WHERE r.denial_id = d.id
      ORDER BY r.started_at DESC
      LIMIT 1
    ) latest ON true
    ORDER BY d.id
  `);
}

// --------------------------------------------------------------- run detail

export interface RunStageRow {
  stage: Stage;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cost: string;
  skipped: boolean;
  inputJson: unknown;
  outputJson: unknown;
}

export interface RunDetail {
  id: string;
  denialId: string;
  status: RunStatus;
  route: string | null;
  routeReason: string | null;
  totalMs: number | null;
  totalCost: string | null;
  startedAt: Date;
  completedAt: Date | null;
  promptVersion: string;
  modelSet: string;
  errorMessage: string | null;
  stages: RunStageRow[];
}

/** The newest completed run for a denial, with every stage. Null when never run. */
export async function loadLatestRun(denialId: string): Promise<RunDetail | null> {
  const [run] = await getDb()
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.denialId, denialId), eq(pipelineRuns.status, "completed")))
    .orderBy(desc(pipelineRuns.completedAt))
    .limit(1);
  if (!run) return null;
  return { ...run, stages: await loadRunStages(run.id) };
}

export async function loadRunStages(runId: string): Promise<RunStageRow[]> {
  return getDb()
    .select({
      stage: stageOutputs.stage,
      ms: stageOutputs.ms,
      tokensIn: stageOutputs.tokensIn,
      tokensOut: stageOutputs.tokensOut,
      cost: stageOutputs.cost,
      skipped: stageOutputs.skipped,
      inputJson: stageOutputs.inputJson,
      outputJson: stageOutputs.outputJson,
    })
    .from(stageOutputs)
    .where(eq(stageOutputs.runId, runId))
    .orderBy(asc(stageOutputs.stage));
}

/** Reviewer feedback already recorded against a run. */
export async function loadFeedback(runId: string) {
  return getDb()
    .select()
    .from(reviewerFeedback)
    .where(eq(reviewerFeedback.runId, runId))
    .orderBy(desc(reviewerFeedback.createdAt));
}

// ---------------------------------------------------------------- dashboards

export type MeasuredMetrics = {
  casesProcessed: number;
  totalDenials: number;
  routeCounts: Record<string, number>;
  medianMs: number | null;
  p90Ms: number | null;
  medianCostUsd: number | null;
  totalCostUsd: number;
  meanValidity: number | null;
  runsWithPerfectValidity: number;
  runsWithValidity: number;
  meanCoverage: number | null;
  reviewedRuns: number;
  approvedAsIs: number;
  meanReviewerMinutes: number | null;
};

/**
 * Everything the metrics dashboard measures, straight from persisted runs.
 *
 * Percentiles and medians are computed in Postgres rather than in JavaScript,
 * so the numbers come from the same place the run log does.
 */
export async function loadMeasuredMetrics(): Promise<MeasuredMetrics> {
  const db = getDb();

  const [totals] = await db.execute<{
    casesProcessed: number;
    medianMs: number | null;
    p90Ms: number | null;
    medianCost: string | null;
    totalCost: string | null;
  }>(sql`
    SELECT
      count(DISTINCT denial_id)::int                                        AS "casesProcessed",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms)                 AS "medianMs",
      percentile_cont(0.9) WITHIN GROUP (ORDER BY total_ms)                 AS "p90Ms",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cost)               AS "medianCost",
      coalesce(sum(total_cost), 0)                                          AS "totalCost"
    FROM pipeline_runs WHERE status = 'completed'
  `);

  const [denialCount] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM denials`);

  const routes = await db.execute<{ route: string; n: number }>(sql`
    SELECT route, count(*)::int AS n FROM pipeline_runs
    WHERE status = 'completed' AND route IS NOT NULL GROUP BY route
  `);

  // Citation validity and coverage live inside stage E's stored output.
  const [quality] = await db.execute<{
    meanValidity: number | null;
    perfect: number;
    withValidity: number;
    meanCoverage: number | null;
  }>(sql`
    SELECT
      avg((output_json -> 'citation' ->> 'validityRate')::float)                                  AS "meanValidity",
      count(*) FILTER (WHERE (output_json -> 'citation' ->> 'validityRate')::float = 1)::int      AS "perfect",
      count(*) FILTER (WHERE output_json -> 'citation' ->> 'validityRate' IS NOT NULL)::int       AS "withValidity",
      avg((output_json -> 'coverage' ->> 'coverage')::float)                                      AS "meanCoverage"
    FROM stage_outputs so
    JOIN pipeline_runs r ON r.id = so.run_id
    WHERE so.stage = 'e_verify' AND so.skipped = false AND r.status = 'completed'
  `);

  const [feedback] = await db.execute<{
    reviewed: number;
    approved: number;
    meanMinutes: number | null;
  }>(sql`
    SELECT
      count(DISTINCT run_id)::int                                   AS "reviewed",
      count(*) FILTER (WHERE action = 'approve')::int               AS "approved",
      avg(reviewer_minutes)::float                                  AS "meanMinutes"
    FROM reviewer_feedback
  `);

  const routeCounts: Record<string, number> = {};
  for (const row of routes) routeCounts[row.route] = Number(row.n);

  return {
    casesProcessed: Number(totals?.casesProcessed ?? 0),
    totalDenials: Number(denialCount?.n ?? 0),
    routeCounts,
    medianMs: totals?.medianMs === null || totals?.medianMs === undefined ? null : Number(totals.medianMs),
    p90Ms: totals?.p90Ms === null || totals?.p90Ms === undefined ? null : Number(totals.p90Ms),
    medianCostUsd: totals?.medianCost === null || totals?.medianCost === undefined ? null : Number(totals.medianCost),
    totalCostUsd: Number(totals?.totalCost ?? 0),
    meanValidity: quality?.meanValidity === null || quality?.meanValidity === undefined ? null : Number(quality.meanValidity),
    runsWithPerfectValidity: Number(quality?.perfect ?? 0),
    runsWithValidity: Number(quality?.withValidity ?? 0),
    meanCoverage: quality?.meanCoverage === null || quality?.meanCoverage === undefined ? null : Number(quality.meanCoverage),
    reviewedRuns: Number(feedback?.reviewed ?? 0),
    approvedAsIs: Number(feedback?.approved ?? 0),
    meanReviewerMinutes:
      feedback?.meanMinutes === null || feedback?.meanMinutes === undefined ? null : Number(feedback.meanMinutes),
  };
}

export type EvalRunRow = {
  id: string;
  createdAt: Date;
  split: string;
  caseCount: number;
  promptVersion: string;
  modelSet: string;
  reference: boolean;
  metricsJson: unknown;
  perCaseJson: unknown;
};

/** Eval runs, newest first. Empty until the M4 harness writes one. */
export async function loadEvalRuns(limit = 20): Promise<EvalRunRow[]> {
  return getDb().execute<EvalRunRow>(sql`
    SELECT id, created_at AS "createdAt", split, case_count AS "caseCount",
           prompt_version AS "promptVersion", model_set AS "modelSet",
           reference, metrics_json AS "metricsJson", per_case_json AS "perCaseJson"
    FROM eval_runs ORDER BY created_at DESC LIMIT ${limit}
  `);
}
