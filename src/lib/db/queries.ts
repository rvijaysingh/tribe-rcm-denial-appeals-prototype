/**
 * Typed queries for the pipeline and the UI.
 *
 * The pipeline reads a case through loadPipelineCase, which deliberately does
 * not touch ground_truth. Labels exist only for the eval harness; a pipeline
 * that could read them would score itself.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { lineLabel } from "../citations";
import type { Condition, DenialCategory, DocType, PayerId, Split } from "../domain";
import { getDb } from "./client";
import { accounts, chartDocs, chartLines, criteriaClauses, criteriaSets, denials, payerNotes, payers } from "./schema";

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
