import { describe, expect, it } from "vitest";
import { buildMatrix } from "../../src/components/detail/evidence-matrix";
import type { Draft } from "../../src/lib/pipeline/draft-schema";
import type { RetrieveOutput } from "../../src/lib/pipeline/c-retrieve";
import type { VerifyResult } from "../../src/lib/pipeline/e-verify";

const FLAGGED = "Vasopressors cannot be delivered in observation.";
const CLEAN = "Blood pressure remained 86/48 after the fluid challenge.";

function draft(): Draft {
  return {
    sections: [
      {
        name: "criteria_argument",
        assertions: [
          { text: CLEAN, chart_line_ids: ["L42"], clause_ids: ["C38"] },
          { text: FLAGGED, chart_line_ids: ["L43"], clause_ids: ["C39"] },
        ],
      },
    ],
    unsupported_required: [],
    draft_confidence: 0.8,
  } as Draft;
}

function retrieval(): RetrieveOutput {
  return {
    query: "q",
    clauses: [
      { id: "C38", code: "SEP-01", text: "Hypotension after fluids.", required: true, score: 1, forced: false },
      { id: "C39", code: "SEP-02", text: "IV antibiotics.", required: true, score: 1, forced: false },
      { id: "C40", code: "SEP-03", text: "Organ dysfunction.", required: true, score: 1, forced: false },
    ],
    precedents: [],
    requiredClauseIds: ["C38", "C39", "C40"],
    embeddingTokens: 0,
    costUsd: 0,
  };
}

function verify(flagged: string[]): VerifyResult {
  return {
    citation: { validityRate: 1, totalCitations: 4, invalidChartLineIds: [], invalidClauseIds: [] },
    coverage: { coverage: 1, coveredRequiredClauseIds: ["C38", "C39"], uncoveredRequiredClauseIds: ["C40"] },
    judge: {
      faithfulness: 0.8,
      completeness: 0.8,
      tone: 0.9,
      overall: 0.72,
      flagged_assertions: flagged.map((assertion_text) => ({ assertion_text, reason: "invented" })),
    },
    decision: { route: "needs_review", route_reason: "flagged", composite: 0.72 },
    usage: null,
  };
}

describe("buildMatrix flag propagation", () => {
  it("marks the clause an unflagged assertion cites as not flagged", () => {
    const rows = buildMatrix(draft(), retrieval(), verify([FLAGGED]));
    expect(rows.find((r) => r.id === "C38")?.flagged).toBe(false);
  });

  it("marks the clause a flagged assertion cites", () => {
    const rows = buildMatrix(draft(), retrieval(), verify([FLAGGED]));
    expect(rows.find((r) => r.id === "C39")?.flagged).toBe(true);
  });

  it("gives a flagged clause the weak status so the row reads consistently", () => {
    const rows = buildMatrix(draft(), retrieval(), verify([FLAGGED]));
    expect(rows.find((r) => r.id === "C39")?.status).toBe("weak");
  });

  it("leaves a clause no assertion cites unflagged and not argued", () => {
    const rows = buildMatrix(draft(), retrieval(), verify([FLAGGED]));
    const row = rows.find((r) => r.id === "C40");
    expect(row?.flagged).toBe(false);
    expect(row?.status).toBe("not_argued");
  });

  it("flags nothing when the judge flagged nothing", () => {
    const rows = buildMatrix(draft(), retrieval(), verify([]));
    expect(rows.every((r) => !r.flagged)).toBe(true);
  });

  it("flags nothing when the judge was skipped", () => {
    const rows = buildMatrix(draft(), retrieval(), null);
    expect(rows.every((r) => !r.flagged)).toBe(true);
  });

  it("matches flags on trimmed text, since the judge echoes the assertion back", () => {
    const rows = buildMatrix(draft(), retrieval(), verify([`  ${FLAGGED}  `]));
    expect(rows.find((r) => r.id === "C39")?.flagged).toBe(true);
  });
});
