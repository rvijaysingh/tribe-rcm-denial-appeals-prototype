/**
 * Display formatting for the UI. Money arrives from Postgres as numeric
 * strings and is formatted through cents, never through float arithmetic.
 */

import { formatUsd, toCents } from "../money";

/** Whole dollars, e.g. "$18,500". Amounts on the workqueue have no cents. */
export function formatDollars(amount: string | number): string {
  const dollars = Math.round(toCents(amount) / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

/** Pipeline cost, which is fractions of a dollar, e.g. "$0.09". */
export function formatCost(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return formatUsd(toCents(amount));
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/** Human labels for enum values, so raw snake_case never reaches the screen. */
export const CATEGORY_LABEL: Record<string, string> = {
  medical_necessity: "Medical necessity",
  level_of_care: "Level of care",
};

export const ROUTE_LABEL: Record<string, string> = {
  ready: "ready",
  needs_review: "needs review",
  needs_docs: "needs docs",
  do_not_appeal: "do not appeal",
};

export const TRIAGE_LABEL: Record<string, string> = {
  appeal: "appeal",
  do_not_appeal: "do not appeal",
};

/** Route badge colours, matching the design's token set. */
export const ROUTE_STYLE: Record<string, string> = {
  ready: "text-green-700 bg-green-50 border-green-200",
  needs_review: "text-amber-700 bg-amber-50 border-amber-200",
  needs_docs: "text-blue-700 bg-blue-50 border-blue-200",
  do_not_appeal: "text-zinc-500 bg-zinc-100 border-zinc-200",
};
