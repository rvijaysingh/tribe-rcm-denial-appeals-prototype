/**
 * Deterministic letter renderer.
 *
 * Pure: the same draft and context always produce the same text. The model
 * writes no letter prose, so nothing in the output can be unsupported by the
 * structured draft it came from. Citation markers are appended to each
 * assertion in the order the draft lists them, chart lines first, so a reviewer
 * can trace any sentence back to the record.
 *
 * Run standalone: npx tsx src/lib/render/letter.ts
 */

import type { SectionName } from "../domain";
import { SECTION_NAMES } from "../domain";
import type { Assertion, Draft } from "../pipeline/draft-schema";

export interface LetterContext {
  payerName: string;
  accountId: string;
  denialId: string;
  memberReference: string;
  conditionLabel: string;
  drg: string;
  admitDate: Date;
  dischargeDate: Date;
  carc: string;
  rarc: string;
}

const SECTION_HEADINGS: Record<SectionName, string> = {
  intro: "INTRODUCTION",
  clinical_summary: "CLINICAL SUMMARY",
  criteria_argument: "CRITERIA ARGUMENT",
  precedent: "PRECEDENT",
  request: "REQUEST",
};

/** MM/DD/YYYY in UTC, matching the denial letters. */
export function formatDate(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

/** Citation markers for one assertion, e.g. "[L47][L48][C12]". Empty when uncited. */
export function formatCitations(assertion: Assertion): string {
  return [...assertion.chart_line_ids, ...assertion.clause_ids].map((id) => `[${id}]`).join("");
}

/** One assertion as a line of letter text, with its citation markers appended. */
export function renderAssertion(assertion: Assertion): string {
  const text = assertion.text.trim();
  const markers = formatCitations(assertion);
  return markers ? `${text} ${markers}` : text;
}

/**
 * Render the appeal letter. Sections appear in the fixed PRD order regardless
 * of the order the model emitted them, and empty sections are omitted rather
 * than printed as bare headings.
 */
export function renderLetter(draft: Draft, context: LetterContext): string {
  const blocks: string[] = [
    "APPEAL OF ADVERSE DETERMINATION",
    [
      `Payer: ${context.payerName}`,
      `Member reference: ${context.memberReference}`,
      `Account: ${context.accountId}`,
      `Denial reference: ${context.denialId}`,
      `Service: Inpatient admission for ${context.conditionLabel}, DRG ${context.drg}`,
      `Dates of service: ${formatDate(context.admitDate)} to ${formatDate(context.dischargeDate)}`,
      `Claim adjustment codes: CARC ${context.carc}, RARC ${context.rarc}`,
    ].join("\n"),
  ];

  for (const name of SECTION_NAMES) {
    const assertions = draft.sections
      .filter((section) => section.name === name)
      .flatMap((section) => section.assertions)
      .filter((assertion) => assertion.text.trim().length > 0);
    if (assertions.length === 0) continue;
    blocks.push(`${SECTION_HEADINGS[name]}\n${assertions.map(renderAssertion).join("\n\n")}`);
  }

  blocks.push("Submitted by the hospital appeals department on behalf of the treating team.");
  return `${blocks.join("\n\n")}\n`;
}

/** Every citation marker in the rendered letter, in order of appearance. */
export function citedIds(draft: Draft): { chartLineIds: string[]; clauseIds: string[] } {
  const chartLineIds: string[] = [];
  const clauseIds: string[] = [];
  for (const section of draft.sections) {
    for (const assertion of section.assertions) {
      chartLineIds.push(...assertion.chart_line_ids);
      clauseIds.push(...assertion.clause_ids);
    }
  }
  return { chartLineIds, clauseIds };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/lib/render/letter.ts")) {
  const draft: Draft = {
    sections: [
      { name: "request", assertions: [{ text: "We request reversal of this determination.", chart_line_ids: [], clause_ids: [] }] },
      {
        name: "criteria_argument",
        assertions: [
          {
            text: "The patient was hypoxemic at rest on arrival and required 4 L/min to maintain saturation.",
            chart_line_ids: ["L10", "L11"],
            clause_ids: ["C1"],
          },
        ],
      },
      { name: "intro", assertions: [{ text: "We appeal the adverse determination below.", chart_line_ids: [], clause_ids: [] }] },
    ],
    unsupported_required: [],
    draft_confidence: 0.9,
  };
  console.log(
    renderLetter(draft, {
      payerName: "Pinnacle Health Plan",
      accountId: "ACC-DEMO-01",
      denialId: "DEMO-01",
      memberReference: "MBR123456789",
      conditionLabel: "CHF exacerbation",
      drg: "291",
      admitDate: new Date("2026-04-10T00:00:00Z"),
      dischargeDate: new Date("2026-04-15T00:00:00Z"),
      carc: "CO-50",
      rarc: "N115",
    }),
  );
}
