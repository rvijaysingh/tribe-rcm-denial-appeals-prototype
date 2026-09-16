/**
 * Stage C: retrieve criteria clauses and precedents (PRD 7 stage C).
 *
 * No LLM call, but one embedding call. Two steps, in this order:
 *
 * 1. Metadata filter, in SQL. Clauses are restricted to the payer's set for
 *    this condition; precedents to this payer, this category, overturned only.
 *    A clause from another payer is not a worse match, it is inadmissible, so
 *    it is excluded before ranking rather than ranked and hoped against.
 * 2. Cosine search within that filtered set.
 *
 * Required clauses are always returned even when they rank low, marked
 * `forced`. A required clause the drafter never sees is a required clause the
 * letter will not argue, and stage E measures coverage against all of them.
 *
 * Honest note for the interview: at this corpus size the metadata filter alone
 * would return 6 to 9 clauses, and ranking them barely matters. The vector step
 * is here because it is the shape production needs, not because 40 records
 * demand it.
 */

import { lineLabel } from "../citations";
import type { Condition, DenialCategory, PayerId, RootCause } from "../domain";
import { allClauses, searchClauses, searchPrecedents } from "../db/queries";
import { embed } from "../embeddings";

export const CLAUSE_LIMIT = 8;
export const PRECEDENT_LIMIT = 3;

export interface RetrieveInput {
  payerId: PayerId;
  condition: Condition;
  category: DenialCategory;
  rootCause: RootCause;
  keyFacts: string[];
}

export interface RetrievedClause {
  id: string;
  code: string;
  text: string;
  required: boolean;
  score: number;
  /** True when the clause was added because it is required, not because it ranked. */
  forced: boolean;
}

export interface RetrievedPrecedent {
  id: string;
  summary: string;
  letterExcerpt: string;
  outcome: string;
  score: number;
}

export interface RetrieveOutput {
  query: string;
  clauses: RetrievedClause[];
  precedents: RetrievedPrecedent[];
  /** Every required clause for this payer and condition, for stage E coverage. */
  requiredClauseIds: string[];
  embeddingTokens: number;
  costUsd: number;
}

/**
 * The search query: what the payer is arguing, plus the facts it relies on.
 * Built from stage B's output rather than the raw letter, so the query is
 * about the argument rather than the payer's boilerplate.
 */
export function buildQuery(rootCause: RootCause, keyFacts: string[]): string {
  // Facts usually arrive already punctuated, so join on a space and give only
  // the root cause its own terminator.
  const facts = keyFacts.map((f) => f.trim()).filter(Boolean);
  return [`${rootCause.replace(/_/g, " ")}.`, ...facts].join(" ").trim();
}

/**
 * Take the top-ranked clauses, then add any required clause that missed the
 * cut. Ranked clauses keep their order; forced ones follow, by code.
 */
export function mergeForcedRequired(
  ranked: (RetrievedClause | Omit<RetrievedClause, "forced">)[],
  limit: number,
): RetrievedClause[] {
  const top = ranked.slice(0, limit).map((c) => ({ ...c, forced: false }));
  const chosen = new Set(top.map((c) => c.id));
  const missingRequired = ranked
    .filter((c) => c.required && !chosen.has(c.id))
    .map((c) => ({ ...c, forced: true }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return [...top, ...missingRequired];
}

export async function retrieve(input: RetrieveInput): Promise<RetrieveOutput> {
  const query = buildQuery(input.rootCause, input.keyFacts);
  const embedded = await embed([query], "query");
  const vector = embedded.vectors[0];

  // The payer's set holds 6 to 9 clauses, so rank the whole set and slice. That
  // also gives every required clause a real similarity score to display.
  const ranked = await searchClauses(input.payerId, input.condition, vector, 100);
  const clauses = mergeForcedRequired(
    ranked.map((c) => ({ ...c, score: Number(c.score) })),
    CLAUSE_LIMIT,
  );

  const precedents = await searchPrecedents(input.payerId, input.category, vector, PRECEDENT_LIMIT);
  const everyClause = await allClauses(input.payerId, input.condition);

  return {
    query,
    clauses,
    precedents: precedents.map((p) => ({
      id: p.id,
      summary: p.summary,
      letterExcerpt: p.letterExcerpt,
      outcome: p.outcome,
      score: Number(p.score),
    })),
    requiredClauseIds: everyClause.filter((c) => c.required).map((c) => c.id),
    embeddingTokens: embedded.tokens,
    costUsd: embedded.costUsd,
  };
}

/** Chart lines formatted for a prompt: "L47: text". */
export function formatChartForPrompt(chart: { lineNo: number; text: string }[]): string {
  return chart.map((l) => `${lineLabel(l.lineNo)}: ${l.text}`).join("\n");
}
