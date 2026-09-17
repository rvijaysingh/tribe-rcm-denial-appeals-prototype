/**
 * Production targets from the proposal.
 *
 * These are NOT measured by this prototype. They come from the outside-in
 * diagnostic and the Phase 1 business case (PRD 2), and the metrics dashboard
 * shows them in a panel separated from anything measured here, with the
 * footnote that they are validated in discovery.
 *
 * Kept apart from economics.ts on purpose: those constants drive triage
 * decisions, these are slideware. Nothing in the pipeline may read this file.
 */

export interface ProductionTarget {
  label: string;
  baseline: string;
  target: string;
  note: string;
}

export const PRODUCTION_TARGETS: ProductionTarget[] = [
  {
    label: "Cost per appeal",
    baseline: "$700 to $1,000",
    target: "$200 to $350",
    note: "RN, ops and physician labour per fully worked appeal.",
  },
  {
    label: "Clinical overturn rate",
    baseline: "~42%",
    target: "46 to 48%",
    note: "Consistent letters and payer rules that currently live in nurse memory.",
  },
  {
    label: "Days to submission",
    baseline: "Days from denial to draft",
    target: "Same day",
    note: "Filing windows run 90 to 180 days; each payer round takes 45 to 60.",
  },
  {
    label: "Physician escalations",
    baseline: "Attestations and peer to peer",
    target: "Reduced",
    note: "Phase 1 targets the first four leaks; this one follows.",
  },
];

/**
 * Shown under cost per case. A panellist who compares this prototype's cents
 * to the dollars on the slide deserves the reason in writing (PRD 6.4).
 */
export const COST_PER_CASE_CAVEAT =
  "Synthetic charts here run 2 to 4 pages. Production charts run to hundreds of pages, and the proposal assumes $2 to $5 per appeal.";
