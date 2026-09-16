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
import { lineKey } from "../../src/lib/citations";
import type { db } from "../../src/lib/db/client";
import {
  accounts,
  chartDocs,
  chartLines,
  criteriaClauses,
  criteriaSets,
  denials,
  groundTruth,
  precedentAppeals,
  payerNotes,
  payers,
} from "../../src/lib/db/schema";
import type { CriteriaArtifact } from "./pass-a-criteria";
import type { CaseSeed } from "./pass-b-cases";
import type { ChartArtifact } from "./pass-c-charts";
import {
  fillLetter,
  letterDeadline,
  type LetterArtifact,
  type PrecedentRecord,
} from "./pass-d-letters";
import type { GroundTruthRecord } from "./pass-e-truth";

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

  // Criteria set IDs embed the payer ID and condition, and the table has a
  // unique(payer_id, condition). So when a set's ID changes, for example when a
  // payer is renamed, inserting the new row collides with the old one that is
  // still present. Drop obsolete sets before inserting, not after. Their
  // clauses cascade and are re-inserted immediately below with the same IDs.
  const removedSets = await deleteOrphans(tx, criteriaSets, criteriaSets.id, setRows.map((r) => r.id));

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
        lineRows.push({ id: lineKey(seed.accountId, lineNo), docId, lineNo, text });
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

/**
 * Pass D: denials and precedent appeals.
 *
 * Letter text is stored with its date tokens filled relative to the anchor, so
 * the letter a nurse reads always agrees with the account's dates.
 */
export async function loadDenialsAndPrecedents(
  tx: Tx,
  cases: CaseSeed[],
  criteria: CriteriaArtifact,
  letters: Map<string, LetterArtifact>,
  precedents: PrecedentRecord[],
  vectors: Map<string, number[]>,
  anchor: Date,
): Promise<LoadCounts> {
  const denialRows: (typeof denials.$inferInsert)[] = cases.map((seed) => {
    const letter = letters.get(seed.denialId);
    if (!letter) throw new Error(`No letter for ${seed.denialId}`);
    const dates = caseDates(seed, anchor);
    return {
      id: seed.denialId,
      accountId: seed.accountId,
      payerId: seed.payerId,
      category: seed.category,
      amount: seed.amount.toFixed(2),
      receivedDate: dates.received,
      carc: seed.carc,
      rarc: seed.rarc,
      letterText: fillLetter(letter.letterTemplate, dates, letterDeadline(seed, criteria)),
      eligible: seed.eligible,
      split: seed.split,
    };
  });

  const precedentRows: (typeof precedentAppeals.$inferInsert)[] = precedents.map((p) => {
    const embedding = vectors.get(p.summary);
    if (!embedding) throw new Error(`No embedding for precedent ${p.id}`);
    return {
      id: p.id,
      payerId: p.payerId,
      category: p.category,
      condition: p.condition,
      summary: p.summary,
      outcome: p.outcome,
      letterExcerpt: p.letterExcerpt,
      embedding,
    };
  });

  await upsertRows(tx, denials, denials.id, denialRows);
  await upsertRows(tx, precedentAppeals, precedentAppeals.id, precedentRows);
  const removedDenials = await deleteOrphans(tx, denials, denials.id, denialRows.map((r) => r.id));
  const removedPrecedents = await deleteOrphans(
    tx,
    precedentAppeals,
    precedentAppeals.id,
    precedentRows.map((r) => r.id),
  );
  return {
    denials: { upserted: denialRows.length, removed: removedDenials },
    precedent_appeals: { upserted: precedentRows.length, removed: removedPrecedents },
  };
}

/** Pass E: ground truth labels. */
export async function loadGroundTruth(tx: Tx, records: GroundTruthRecord[]): Promise<LoadCounts> {
  const rows: (typeof groundTruth.$inferInsert)[] = records.map((r) => ({
    denialId: r.denialId,
    category: r.category,
    rootCause: r.rootCause,
    metClauseIds: r.metClauseIds,
    unmetRequiredClauseIds: r.unmetRequiredClauseIds,
    expectedRoute: r.expectedRoute,
    winnable: r.winnable,
    approveAsIs: r.approveAsIs,
    spotChecked: r.spotChecked,
    spotCheckNote: r.spotCheckNote,
  }));
  await upsertRows(tx, groundTruth, groundTruth.denialId, rows);
  const removed = await deleteOrphans(tx, groundTruth, groundTruth.denialId, rows.map((r) => r.denialId));
  return { ground_truth: { upserted: rows.length, removed } };
}
