/**
 * Phase 1 levers from the proposal.
 *
 * These are NOT measured by this prototype. They come from the outside-in
 * diagnostic and the Phase 1 business case (PRD 2), and the dashboard shows
 * them in a panel separated from anything measured here.
 *
 * Kept apart from economics.ts on purpose: those constants drive triage
 * decisions, these are slideware. Nothing in the pipeline may read this file.
 *
 * Rates and per-appeal figures only. No book-level dollars anywhere.
 */

/** Where the prototype has a real number to put beside a lever. */
export type MeasuredKey = "costPerCase" | "rnTouchTime";

export interface PhaseOneLever {
  label: string;
  today: string;
  target2027: string;
  target2028: string;
  /** Sub-line under the row, for a lever whose driver needs naming. */
  note?: string;
  /**
   * A lever with no target, watched rather than hit. Rendered without target
   * figures so it cannot be mistaken for a commitment.
   */
  guardrail?: boolean;
  /** Which measured figure belongs in the "Measured here" column, if any. */
  measured?: MeasuredKey;
}

export const PHASE_ONE_LEVERS: PhaseOneLever[] = [
  {
    label: "Net $ denial recovery rate",
    today: "42%",
    target2027: "55%",
    target2028: "60%",
  },
  {
    label: "Appeal rate (share worked)",
    today: "70%",
    target2027: "87%",
    target2028: "87%",
    note: "Driven by the work threshold falling from ~$5K to ~$1.2K",
  },
  {
    label: "Appeal win rate (by count)",
    today: "60%",
    target2027: "65%",
    target2028: "69%",
  },
  {
    label: "Cost per appeal (fully loaded)",
    today: "$735",
    target2027: "$300",
    target2028: "$300",
    measured: "costPerCase",
  },
  {
    label: "RN touch time per appeal",
    today: "~210 min",
    target2027: "10 to 15 min",
    target2028: "10 to 15 min",
    measured: "rnTouchTime",
  },
  {
    label: "Net $ recovered per RN hour",
    today: "Guardrail",
    target2027: "",
    target2028: "",
    guardrail: true,
    note: "No target. Must rise each quarter.",
  },
];

/** Shown under the levers table (PRD 6.4). */
export const TARGETS_FOOTER = "Targets illustrative, validated in discovery.";

/**
 * Shown under cost per case. A panellist who compares this prototype's cents
 * to the dollars on the slide deserves the reason in writing (PRD 6.4).
 */
export const COST_PER_CASE_CAVEAT =
  "Synthetic charts here run 2 to 4 pages. Production charts run to hundreds of pages, and the proposal assumes $2 to $5 per appeal.";
