/**
 * Idempotent database loader for seed artifacts.
 *
 * Upserts every row by primary key, then deletes rows no longer in the
 * artifact. Upsert rather than truncate-and-insert so that pipeline runs,
 * reviewer feedback, and eval history survive a reseed: those tables hang off
 * denials by foreign key, and denial IDs are stable across reseeds.
 *
 * Callers run each loader inside one transaction, so a failed seed leaves the
 * database unchanged.
 */

import { getTableColumns, notInArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { db } from "../../src/lib/db/client";
import {
  accounts,
  chartDocs,
  chartLines,
  criteriaClauses,
  criteriaSets,
  payerNotes,
  payers,
} from "../../src/lib/db/schema";
import type { CriteriaArtifact } from "./pass-a-criteria";
import type { CaseSeed } from "./pass-b-cases";
import type { ChartArtifact } from "./pass-c-charts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Anchor date for converting seed day offsets into dates: midnight UTC on the
 * day the seed runs. Reseeding on a later day moves every date forward, which
 * keeps days-left for each case exactly as the seed specifies.
 */
export function seedAnchor(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function daysBefore(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() - days * DAY_MS);
}

/** Received, discharge and admit dates for a case, relative to the anchor. */
export function caseDates(seed: CaseSeed, anchor: Date): { received: Date; discharge: Date; admit: Date } {
  const received = daysBefore(anchor, seed.daysSinceReceived);
  const discharge = daysBefore(received, seed.dischargeToDenialDays);
  const admit = daysBefore(discharge, seed.patient.losDays);
  return { received, discharge, admit };
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CHUNK = 500;

/** SET clause assigning every non-key column from the proposed row. */
function excludedColumns(table: PgTable, idColumn: AnyPgColumn): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (column.name === idColumn.name) continue;
    set[property] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}

/**
 * Insert or update rows by primary key, in chunks. Drizzle cannot type a
 * generic table's insert shape, so rows are checked by each caller's typed
 * mapping and cast here.
 */
async function upsertRows(
  tx: Tx,
  table: PgTable,
  idColumn: AnyPgColumn,
  rows: object[],
): Promise<void> {
  const set = excludedColumns(table, idColumn);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx
      .insert(table)
      .values(rows.slice(i, i + CHUNK) as never)
      .onConflictDoUpdate({ target: idColumn, set: set as never });
  }
}

/** Delete rows whose ID is not in `keepIds`. Returns the number removed. */
async function deleteOrphans(
  tx: Tx,
  table: PgTable,
  idColumn: AnyPgColumn,
  keepIds: string[],
): Promise<number> {
  const removed = await tx.delete(table).where(notInArray(idColumn, keepIds)).returning({ id: idColumn });
  return removed.length;
}

export interface LoadCounts {
  [table: string]: { upserted: number; removed: number };
}

/**
 * Pass A: payers, criteria sets, clauses, payer notes.
 * `vectors` maps exact text to its embedding.
 */
export async function loadCriteria(
  tx: Tx,
  artifact: CriteriaArtifact,
  vectors: Map<string, number[]>,
): Promise<LoadCounts> {
  const vectorFor = (text: string): number[] => {
    const v = vectors.get(text);
    if (!v) throw new Error(`No embedding for text: "${text.slice(0, 60)}..."`);
    return v;
  };

  const payerRows: (typeof payers.$inferInsert)[] = artifact.payers.map((p) => ({
    id: p.id,
    name: p.name,
    criteriaStyle: p.criteriaStyle,
    deadlineDays: p.deadlineDays,
    appealFormatNotes: p.appealFormatNotes,
  }));
  const setRows: (typeof criteriaSets.$inferInsert)[] = artifact.criteriaSets.map((s) => ({
    id: s.id,
    payerId: s.payerId,
    condition: s.condition,
    version: s.version,
  }));
  const clauseRows: (typeof criteriaClauses.$inferInsert)[] = artifact.clauses.map((c) => ({
    id: c.id,
    setId: c.setId,
    code: c.code,
    text: c.text,
    required: c.required,
    embedding: vectorFor(c.text),
  }));
  const noteRows: (typeof payerNotes.$inferInsert)[] = artifact.payerNotes.map((n) => ({
    id: n.id,
    payerId: n.payerId,
    condition: n.condition,
    text: n.text,
    embedding: vectorFor(n.text),
  }));

  // Parents before children on the way in.
  await upsertRows(tx, payers, payers.id, payerRows);
  await upsertRows(tx, criteriaSets, criteriaSets.id, setRows);
  await upsertRows(tx, criteriaClauses, criteriaClauses.id, clauseRows);
  await upsertRows(tx, payerNotes, payerNotes.id, noteRows);

  // Children before parents on the way out.
  const removedNotes = await deleteOrphans(tx, payerNotes, payerNotes.id, noteRows.map((r) => r.id));
  const removedClauses = await deleteOrphans(
    tx,
    criteriaClauses,
    criteriaClauses.id,
    clauseRows.map((r) => r.id),
  );
  const removedSets = await deleteOrphans(tx, criteriaSets, criteriaSets.id, setRows.map((r) => r.id));
  const removedPayers = await deleteOrphans(tx, payers, payers.id, payerRows.map((r) => r.id));

  return {
    payers: { upserted: payerRows.length, removed: removedPayers },
    criteria_sets: { upserted: setRows.length, removed: removedSets },
    criteria_clauses: { upserted: clauseRows.length, removed: removedClauses },
    payer_notes: { upserted: noteRows.length, removed: removedNotes },
  };
}

/** Pass B: accounts. Denials load with pass D, once letter text exists. */
export async function loadAccounts(tx: Tx, cases: CaseSeed[], anchor: Date): Promise<LoadCounts> {
  const rows: (typeof accounts.$inferInsert)[] = cases.map((c) => {
    const { admit, discharge } = caseDates(c, anchor);
    return {
      id: c.accountId,
      mrn: c.patient.mrn,
      patientAge: c.patient.age,
      admitDate: admit,
      dischargeDate: discharge,
      drg: c.patient.drg,
      condition: c.condition,
    };
  });

  await upsertRows(tx, accounts, accounts.id, rows);
  const removed = await deleteOrphans(tx, accounts, accounts.id, rows.map((r) => r.id));
  return { accounts: { upserted: rows.length, removed } };
}

/**
 * Pass C: chart documents and line-numbered chart lines.
 *
 * Line numbers run continuously across a case's documents, so "L47" is unique
 * within a case and is what the drafter cites. The database ID prefixes the
 * account ID ("ACC-017-L47") to stay unique across cases.
 */
export async function loadCharts(
  tx: Tx,
  cases: CaseSeed[],
  charts: Map<string, ChartArtifact>,
): Promise<LoadCounts> {
  const docRows: (typeof chartDocs.$inferInsert)[] = [];
  const lineRows: (typeof chartLines.$inferInsert)[] = [];

  for (const seed of cases) {
    const chart = charts.get(seed.denialId);
    if (!chart) throw new Error(`No chart for ${seed.denialId}`);
    let lineNo = 0;
    chart.documents.forEach((doc, i) => {
      const docId = `${seed.accountId}-D${i + 1}`;
      docRows.push({ id: docId, accountId: seed.accountId, docType: doc.docType, text: doc.lines.join("\n") });
      for (const text of doc.lines) {
        lineNo += 1;
        lineRows.push({ id: `${seed.accountId}-L${lineNo}`, docId, lineNo, text });
      }
    });
  }

  await upsertRows(tx, chartDocs, chartDocs.id, docRows);
  await upsertRows(tx, chartLines, chartLines.id, lineRows);
  const removedLines = await deleteOrphans(tx, chartLines, chartLines.id, lineRows.map((r) => r.id));
  const removedDocs = await deleteOrphans(tx, chartDocs, chartDocs.id, docRows.map((r) => r.id));
  return {
    chart_docs: { upserted: docRows.length, removed: removedDocs },
    chart_lines: { upserted: lineRows.length, removed: removedLines },
  };
}
