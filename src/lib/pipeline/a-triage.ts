/**
 * Stage A: triage (PRD 7 stage A).
 *
 * Fully deterministic, no LLM. Decides whether a denial is worth appealing
 * before any money is spent on the model: if this returns do_not_appeal, the
 * orchestrator ends the run and stages B to E never execute.
 *
 * All money comparisons are in integer cents, so a case cannot land on the
 * wrong side of a threshold through floating point.
 *
 * Run standalone: npx tsx src/lib/pipeline/a-triage.ts
 */

import type { DenialCategory, PayerId } from "../domain";
import {
  COST_PER_APPEAL_AI,
  COST_PER_APPEAL_MANUAL,
  OLD_CAPACITY_CUTOFF,
  isAppealableCategory,
  winRate,
} from "../economics";
import { expectedValueCents, formatUsd, toCents, toDollars } from "../money";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TriageInput {
  payerId: PayerId;
  category: DenialCategory;
  /** Postgres numeric string or dollars. */
  amount: string | number;
  receivedDate: Date;
  /** Days from receipt to the payer's filing deadline. */
  deadlineDays: number;
  /** False when the account is flagged non-appealable outright. */
  eligible: boolean;
}

export type TriageReasonCode =
  | "appealable"
  | "account_flagged"
  | "ineligible_category"
  | "expired"
  | "below_ev";

export interface TriageOutput {
  decision: "appeal" | "do_not_appeal";
  reason_code: TriageReasonCode;
  /** One sentence for the UI, with the numbers that drove the decision. */
  reason: string;
  days_left: number;
  p_overturn: number;
  expected_value: number;
  /** The same figure in cents, which is what the comparison actually used. */
  expected_value_cents: number;
  amount_cents: number;
  threshold_cents: number;
  /**
   * Whether the old capacity-constrained process would have worked this
   * denial. Stored for the threshold story on the workqueue (PRD 7 stage A).
   */
  would_have_been_worked_old: boolean;
}

/** Whole days between two instants, counted on UTC day boundaries. */
export function daysBetween(from: Date, to: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/**
 * Triage one denial. `now` is injectable so tests and evals are not at the
 * mercy of the clock.
 */
export function triage(input: TriageInput, now: Date = new Date()): TriageOutput {
  const amountCents = toCents(input.amount);
  const pOverturn = winRate(input.payerId, input.category);
  const evCents = expectedValueCents(amountCents, pOverturn);
  const thresholdCents = toCents(COST_PER_APPEAL_AI);
  const daysLeft = input.deadlineDays - daysBetween(input.receivedDate, now);

  // The old process needed the appeal to clear a much higher labor cost AND
  // the dollar amount to clear the capacity cutoff that nurse hours imposed.
  const wouldHaveBeenWorkedOld =
    evCents > toCents(COST_PER_APPEAL_MANUAL) && amountCents >= toCents(OLD_CAPACITY_CUTOFF);

  const base = {
    days_left: daysLeft,
    p_overturn: pOverturn,
    expected_value: toDollars(evCents),
    expected_value_cents: evCents,
    amount_cents: amountCents,
    threshold_cents: thresholdCents,
    would_have_been_worked_old: wouldHaveBeenWorkedOld,
  };

  // Order matters: report the most fundamental reason a case cannot be worked.
  if (!input.eligible) {
    return {
      ...base,
      decision: "do_not_appeal",
      reason_code: "account_flagged",
      reason: "The account is flagged as non-appealable.",
    };
  }
  if (!isAppealableCategory(input.payerId, input.category)) {
    return {
      ...base,
      decision: "do_not_appeal",
      reason_code: "ineligible_category",
      reason: `This payer does not accept provider appeals on ${input.category.replace(/_/g, " ")} denials.`,
    };
  }
  if (daysLeft <= 0) {
    return {
      ...base,
      decision: "do_not_appeal",
      reason_code: "expired",
      reason: `The ${input.deadlineDays} day filing window closed ${Math.abs(daysLeft)} day(s) ago.`,
    };
  }
  if (evCents <= thresholdCents) {
    return {
      ...base,
      decision: "do_not_appeal",
      reason_code: "below_ev",
      reason:
        `Expected value ${formatUsd(evCents)} (${formatUsd(amountCents)} x ${pOverturn.toFixed(2)}) ` +
        `does not clear the ${formatUsd(thresholdCents)} cost to work it.`,
    };
  }
  return {
    ...base,
    decision: "appeal",
    reason_code: "appealable",
    reason:
      `Expected value ${formatUsd(evCents)} (${formatUsd(amountCents)} x ${pOverturn.toFixed(2)}) ` +
      `clears the ${formatUsd(thresholdCents)} cost to work it, with ${daysLeft} days left to file.`,
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/lib/pipeline/a-triage.ts")) {
  const now = new Date();
  const examples: [string, TriageInput][] = [
    [
      "DEMO-01 style",
      { payerId: "pinnacle", category: "medical_necessity", amount: "18500.00", receivedDate: new Date(now.getTime() - 139 * DAY_MS), deadlineDays: 180, eligible: true },
    ],
    [
      "DEMO-02 style, under the old cutoff",
      { payerId: "cascade", category: "level_of_care", amount: "2400.00", receivedDate: new Date(now.getTime() - 60 * DAY_MS), deadlineDays: 120, eligible: true },
    ],
    [
      "DNA-02 style, below EV",
      { payerId: "northgate", category: "medical_necessity", amount: "700.00", receivedDate: new Date(now.getTime() - 30 * DAY_MS), deadlineDays: 90, eligible: true },
    ],
    [
      "DNA-01 style, expired",
      { payerId: "pinnacle", category: "level_of_care", amount: "12400.00", receivedDate: new Date(now.getTime() - 184 * DAY_MS), deadlineDays: 180, eligible: true },
    ],
  ];
  for (const [label, input] of examples) {
    const out = triage(input, now);
    console.log(
      `${label.padEnd(36)} ${out.decision.padEnd(14)} ${out.reason_code.padEnd(20)} ` +
        `EV ${formatUsd(out.expected_value_cents).padStart(12)} days ${String(out.days_left).padStart(4)} ` +
        `old=${out.would_have_been_worked_old}`,
    );
    console.log(`  ${out.reason}`);
  }
}
