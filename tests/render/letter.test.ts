import { describe, expect, it } from "vitest";
import type { Draft } from "../../src/lib/pipeline/draft-schema";
import {
  citedIds,
  formatCitations,
  formatDate,
  renderAssertion,
  renderLetter,
  type LetterContext,
} from "../../src/lib/render/letter";

const context: LetterContext = {
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
};

const draft = (sections: Draft["sections"]): Draft => ({
  sections,
  unsupported_required: [],
  draft_confidence: 0.9,
});

describe("formatDate", () => {
  it("formats in UTC as MM/DD/YYYY", () => {
    expect(formatDate(new Date("2026-04-10T00:00:00Z"))).toBe("04/10/2026");
  });

  it("does not shift the day for a late-evening UTC time", () => {
    expect(formatDate(new Date("2026-04-10T23:59:00Z"))).toBe("04/10/2026");
  });
});

describe("formatCitations", () => {
  it("lists chart lines before clauses", () => {
    expect(formatCitations({ text: "x", chart_line_ids: ["L47", "L48"], clause_ids: ["C12"] })).toBe(
      "[L47][L48][C12]",
    );
  });

  it("is empty when the assertion cites nothing", () => {
    expect(formatCitations({ text: "x", chart_line_ids: [], clause_ids: [] })).toBe("");
  });
});

describe("renderAssertion", () => {
  it("appends markers after the text", () => {
    expect(renderAssertion({ text: "Hypoxemic at rest.", chart_line_ids: ["L10"], clause_ids: ["C1"] })).toBe(
      "Hypoxemic at rest. [L10][C1]",
    );
  });

  it("leaves an uncited assertion without a trailing space", () => {
    expect(renderAssertion({ text: "We appeal.", chart_line_ids: [], clause_ids: [] })).toBe("We appeal.");
  });

  it("trims stray whitespace from the model", () => {
    expect(renderAssertion({ text: "  Padded.  ", chart_line_ids: [], clause_ids: [] })).toBe("Padded.");
  });
});

describe("renderLetter", () => {
  const full = draft([
    { name: "request", assertions: [{ text: "Reverse the determination.", chart_line_ids: [], clause_ids: [] }] },
    {
      name: "criteria_argument",
      assertions: [{ text: "Saturation was 86% on room air.", chart_line_ids: ["L10"], clause_ids: ["C1"] }],
    },
    { name: "intro", assertions: [{ text: "We appeal.", chart_line_ids: [], clause_ids: [] }] },
  ]);

  it("is deterministic", () => {
    expect(renderLetter(full, context)).toBe(renderLetter(full, context));
  });

  it("orders sections per the PRD regardless of the order the model emitted", () => {
    const text = renderLetter(full, context);
    expect(text.indexOf("INTRODUCTION")).toBeLessThan(text.indexOf("CRITERIA ARGUMENT"));
    expect(text.indexOf("CRITERIA ARGUMENT")).toBeLessThan(text.indexOf("REQUEST"));
  });

  it("includes the case header the reviewer needs", () => {
    const text = renderLetter(full, context);
    for (const expected of [
      "Payer: Pinnacle Health Plan",
      "Account: ACC-DEMO-01",
      "DRG 291",
      "Dates of service: 04/10/2026 to 04/15/2026",
      "CARC CO-50, RARC N115",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("omits a section with no assertions rather than printing a bare heading", () => {
    expect(renderLetter(full, context)).not.toContain("PRECEDENT");
  });

  it("omits a section whose assertions are all empty text", () => {
    const withBlank = draft([
      { name: "intro", assertions: [{ text: "We appeal.", chart_line_ids: [], clause_ids: [] }] },
      { name: "precedent", assertions: [{ text: "   ", chart_line_ids: [], clause_ids: [] }] },
    ]);
    expect(renderLetter(withBlank, context)).not.toContain("PRECEDENT");
  });

  it("merges duplicate sections of the same name", () => {
    const duplicated = draft([
      { name: "clinical_summary", assertions: [{ text: "First.", chart_line_ids: ["L1"], clause_ids: [] }] },
      { name: "clinical_summary", assertions: [{ text: "Second.", chart_line_ids: ["L2"], clause_ids: [] }] },
    ]);
    const text = renderLetter(duplicated, context);
    expect(text.match(/CLINICAL SUMMARY/g)).toHaveLength(1);
    expect(text).toContain("First. [L1]");
    expect(text).toContain("Second. [L2]");
  });

  it("renders a draft with no sections as a header and closing only", () => {
    const text = renderLetter(draft([]), context);
    expect(text).toContain("APPEAL OF ADVERSE DETERMINATION");
    expect(text).not.toContain("INTRODUCTION");
    expect(text.trimEnd().endsWith("on behalf of the treating team.")).toBe(true);
  });

  it("never invents text beyond the draft and the fixed header and closing", () => {
    const text = renderLetter(full, context);
    const boilerplate = [
      "APPEAL OF ADVERSE DETERMINATION",
      "Payer:",
      "Member reference:",
      "Account:",
      "Denial reference:",
      "Service:",
      "Dates of service:",
      "Claim adjustment codes:",
      "INTRODUCTION",
      "CRITERIA ARGUMENT",
      "REQUEST",
      "Submitted by the hospital appeals department",
    ];
    const remaining = text
      .split("\n")
      .filter((line) => line.trim() && !boilerplate.some((b) => line.startsWith(b)))
      .join("\n");
    expect(remaining).toBe("We appeal.\nSaturation was 86% on room air. [L10][C1]\nReverse the determination.");
  });

  it("ends with a single trailing newline", () => {
    const text = renderLetter(full, context);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("citedIds", () => {
  it("collects every cited ID in order, including duplicates", () => {
    const d = draft([
      {
        name: "criteria_argument",
        assertions: [
          { text: "a", chart_line_ids: ["L10", "L11"], clause_ids: ["C1"] },
          { text: "b", chart_line_ids: ["L10"], clause_ids: ["C2", "C1"] },
        ],
      },
    ]);
    expect(citedIds(d)).toEqual({ chartLineIds: ["L10", "L11", "L10"], clauseIds: ["C1", "C2", "C1"] });
  });

  it("returns empty lists for an uncited draft", () => {
    expect(citedIds(draft([{ name: "intro", assertions: [{ text: "x", chart_line_ids: [], clause_ids: [] }] }]))).toEqual(
      { chartLineIds: [], clauseIds: [] },
    );
  });
});
