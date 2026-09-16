/**
 * Triage constants and the stage A expected-value math.
 *
 * Single source of truth for cost assumptions, win rates, and routing
 * thresholds. Per CLAUDE.md these values are not changed without asking.
 * Every number here is either from the PRD or from the proposal's discovery
 * figures, and each is labeled with which.
 */

import type { DenialCategory, PayerId } from "./domain";

/** Fully loaded RN, ops, and physician labor per manually worked appeal (PRD 2). */
export const COST_PER_APPEAL_MANUAL = 735;

/** Target blended cost per appeal under the AI pipeline (PRD 10). */
export const COST_PER_APPEAL_AI = 275;

/**
 * The dollar amount below which denials were never worked under the old
 * capacity-constrained model. Nurse hours, not economics, set this (PRD 2).
 */
export const OLD_CAPACITY_CUTOFF = 5000;

/** Composite score at or above which a draft routes "ready" (PRD 7 stage E). */
export const READY_THRESHOLD = 0.85;

/** Composite score at or above which a draft routes "needs review". */
export const REVIEW_THRESHOLD = 0.6;

/**
 * Below this payer-specific overturn rate the review panel shows a
 * payer-history warning (PRD 6.3).
 */
export const PAYER_HISTORY_WARN_THRESHOLD = 0.4;

/**
 * P(overturn) by payer and denial category, seeded from the synthetic
 * precedent store. PRD 7 stage A constrains these to [0.35, 0.75].
 *
 * Northgate medical_necessity sits below PAYER_HISTORY_WARN_THRESHOLD on
 * purpose so the payer-history flag has something to fire on during the demo.
 */
export const WIN_RATE: Record<PayerId, Record<DenialCategory, number>> = {
  meridian: { medical_necessity: 0.62, level_of_care: 0.55 },
  cascade: { medical_necessity: 0.58, level_of_care: 0.48 },
  northgate: { medical_necessity: 0.38, level_of_care: 0.42 },
};

/**
 * Categories each payer permits an appeal on. Northgate refusing level_of_care
 * appeals is what makes the third pre-triaged do-not-appeal row ineligible
 * rather than uneconomic (PRD 8.3).
 */
export const APPEALABLE_CATEGORIES: Record<PayerId, readonly DenialCategory[]> = {
  meridian: ["medical_necessity", "level_of_care"],
  cascade: ["medical_necessity", "level_of_care"],
  northgate: ["medical_necessity"],
};

/**
 * Largest denial amount that still falls below the appeal threshold at the
 * lowest win rate in the table. Used by the seed to build the
 * "below economic threshold" row.
 *
 * PRD 8.3 illustrates that row as "$900 at P=0.25", but 0.25 is outside the
 * [0.35, 0.75] range stage A specifies, and at the real floor of 0.38 a $900
 * denial yields EV $342, which clears the $275 threshold and would route to
 * appeal. The seed therefore uses an amount derived from this bound instead of
 * the literal $900. Open question, flagged to the owner.
 */
export const MIN_WIN_RATE = Math.min(
  ...Object.values(WIN_RATE).flatMap((byCategory) => Object.values(byCategory)),
);

/** Returns P(overturn) for a payer and category. Throws on an unknown pair. */
export function winRate(payer: PayerId, category: DenialCategory): number {
  const rate = WIN_RATE[payer]?.[category];
  if (rate === undefined) {
    throw new Error(`No WIN_RATE entry for payer "${payer}" category "${category}".`);
  }
  return rate;
}

/** True when the payer accepts appeals on this denial category. */
export function isAppealableCategory(payer: PayerId, category: DenialCategory): boolean {
  return APPEALABLE_CATEGORIES[payer]?.includes(category) ?? false;
}

/** True when the payer overturns this category rarely enough to warn the RN. */
export function hasWeakPayerHistory(payer: PayerId, category: DenialCategory): boolean {
  return winRate(payer, category) < PAYER_HISTORY_WARN_THRESHOLD;
}

if (process.argv[1]?.endsWith("economics.ts")) {
  console.log("COST_PER_APPEAL_AI:", COST_PER_APPEAL_AI);
  console.log("COST_PER_APPEAL_MANUAL:", COST_PER_APPEAL_MANUAL);
  console.log("OLD_CAPACITY_CUTOFF:", OLD_CAPACITY_CUTOFF);
  console.log("MIN_WIN_RATE:", MIN_WIN_RATE);
  console.log("max under-threshold amount:", Math.floor(COST_PER_APPEAL_AI / MIN_WIN_RATE));
  console.table(WIN_RATE);
}
