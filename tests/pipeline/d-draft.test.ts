import { describe, expect, it } from "vitest";
import type { Draft } from "../../src/lib/pipeline/draft-schema";
import { checkDraft, formatClauseBlock, renderDraftPrompt } from "../../src/lib/pipeline/d-draft";

const sound: Draft = {
  sections: [
    { name: "intro", assertions: [{ text: "We appeal.", chart_line_ids: [], clause_ids: [] }] },
    {
      name: "clinical_summary",
      assertions: [{ text: "SpO2 86% on room air.", chart_line_ids: ["L10"], clause_ids: [] }],
    },
    {
      name: "criteria_argument",
      assertions: [{ text: "C1 is met.", chart_line_ids: ["L10"], clause_ids: ["C1"] }],
    },
    { name: "request", assertions: [{ text: "Reverse it.", chart_line_ids: [], clause_ids: [] }] },
  ],
  unsupported_required: [],
  draft_confidence: 0.9,
};

const withSections = (sections: Draft["sections"]): Draft => ({ ...sound, sections });

describe("checkDraft: structure", () => {
  it("accepts a sound draft", () => {
    expect(checkDraft(sound)).toBeNull();
  });

  it("requires a criteria_argument section", () => {
    expect(checkDraft(withSections(sound.sections.filter((s) => s.name !== "criteria_argument")))).toMatch(
      /missing the criteria_argument section/,
    );
  });

  it("requires a request section", () => {
    expect(checkDraft(withSections(sound.sections.filter((s) => s.name !== "request")))).toMatch(
      /missing the request section/,
    );
  });

  it("rejects a duplicated section", () => {
    expect(checkDraft(withSections([...sound.sections, sound.sections[2]]))).toMatch(
      /duplicate section\(s\): criteria_argument/,
    );
  });

  it("rejects an empty section rather than letting the renderer drop it silently", () => {
    expect(checkDraft(withSections([...sound.sections, { name: "precedent", assertions: [] }]))).toMatch(
      /section precedent has no assertions/,
    );
  });

  it("rejects an assertion with empty text", () => {
    const broken = structuredClone(sound);
    broken.sections[1].assertions[0].text = "   ";
    expect(checkDraft(broken)).toMatch(/clinical_summary assertion 1 has empty text/);
  });
});

describe("checkDraft: citations", () => {
  it("requires a chart line outside intro and request", () => {
    const broken = structuredClone(sound);
    broken.sections[1].assertions[0].chart_line_ids = [];
    expect(checkDraft(broken)).toMatch(/clinical_summary assertion 1 cites no chart line/);
  });

  it("allows intro and request to cite nothing", () => {
    expect(checkDraft(sound)).toBeNull();
  });

  it("requires a precedent assertion to cite a chart line", () => {
    const broken = withSections([
      ...sound.sections,
      { name: "precedent", assertions: [{ text: "A prior appeal succeeded.", chart_line_ids: [], clause_ids: [] }] },
    ]);
    expect(checkDraft(broken)).toMatch(/precedent assertion 1 cites no chart line/);
  });

  it("requires a criteria clause in criteria_argument", () => {
    const broken = structuredClone(sound);
    broken.sections[2].assertions[0].clause_ids = [];
    expect(checkDraft(broken)).toMatch(/criteria_argument assertion 1 cites no criteria clause/);
  });

  it("rejects a malformed chart line ID", () => {
    const broken = structuredClone(sound);
    broken.sections[1].assertions[0].chart_line_ids = ["line 10"];
    expect(checkDraft(broken)).toMatch(/malformed chart line ID\(s\): line 10/);
  });

  it("rejects a database key used as a citation", () => {
    const broken = structuredClone(sound);
    broken.sections[1].assertions[0].chart_line_ids = ["ACC-DEMO-03-L10"];
    expect(checkDraft(broken)).toMatch(/malformed chart line ID/);
  });

  it("rejects a malformed clause ID", () => {
    const broken = structuredClone(sound);
    broken.sections[2].assertions[0].clause_ids = ["SEP-01"];
    expect(checkDraft(broken)).toMatch(/malformed clause ID\(s\): SEP-01/);
  });

  it("does not check whether a cited ID exists, because stage E measures that", () => {
    const invented = structuredClone(sound);
    invented.sections[1].assertions[0].chart_line_ids = ["L99999"];
    invented.sections[2].assertions[0].clause_ids = ["C99999"];
    expect(checkDraft(invented)).toBeNull();
  });
});

describe("checkDraft: unsupported_required", () => {
  it("accepts a gap the draft does not argue", () => {
    const draft = structuredClone(sound);
    draft.unsupported_required = [{ clause_id: "C65", evidence_needed: "A serum lactate result." }];
    expect(checkDraft(draft)).toBeNull();
  });

  it("rejects conceding a gap while arguing the same clause is met", () => {
    const draft = structuredClone(sound);
    draft.unsupported_required = [{ clause_id: "C1", evidence_needed: "A serum lactate result." }];
    expect(checkDraft(draft)).toMatch(/C1 is listed in unsupported_required but is also argued/);
  });

  it("rejects a gap with no evidence named", () => {
    const draft = structuredClone(sound);
    draft.unsupported_required = [{ clause_id: "C65", evidence_needed: "  " }];
    expect(checkDraft(draft)).toMatch(/does not say what evidence is needed/);
  });

  it("rejects a malformed clause ID in a gap", () => {
    const draft = structuredClone(sound);
    draft.unsupported_required = [{ clause_id: "SEP-01", evidence_needed: "A lactate." }];
    expect(checkDraft(draft)).toMatch(/unsupported_required has malformed clause ID/);
  });
});

describe("checkDraft: unsupported_required must be a required clause", () => {
  const required = new Set(["C65", "C66"]);

  it("accepts conceding a required clause", () => {
    const d = structuredClone(sound);
    d.unsupported_required = [{ clause_id: "C65", evidence_needed: "A serum lactate result." }];
    expect(checkDraft(d, required)).toBeNull();
  });

  it("rejects conceding a clause that is not required", () => {
    const d = structuredClone(sound);
    d.unsupported_required = [{ clause_id: "C70", evidence_needed: "A blood gas." }];
    expect(checkDraft(d, required)).toMatch(/C70 is in unsupported_required but is not a required clause/);
  });

  it("skips the check when the required set is not supplied", () => {
    const d = structuredClone(sound);
    d.unsupported_required = [{ clause_id: "C70", evidence_needed: "A blood gas." }];
    expect(checkDraft(d)).toBeNull();
  });
});

describe("checkDraft: confidence", () => {
  it.each([-0.1, 1.5, Number.NaN])("rejects draft_confidence %s", (draft_confidence) => {
    expect(checkDraft({ ...sound, draft_confidence })).toMatch(/draft_confidence/);
  });

  it("accepts both bounds", () => {
    expect(checkDraft({ ...sound, draft_confidence: 0 })).toBeNull();
    expect(checkDraft({ ...sound, draft_confidence: 1 })).toBeNull();
  });
});

describe("formatClauseBlock", () => {
  it("marks required clauses so the drafter can tell them apart", () => {
    const block = formatClauseBlock([
      { id: "C1", code: "SEP-01", text: "Lactate.", required: true, score: 0.9, forced: false },
      { id: "C2", code: "SEP-02", text: "Cultures.", required: false, score: 0.8, forced: false },
    ]);
    expect(block).toBe("C1 (SEP-01) [REQUIRED]: Lactate.\nC2 (SEP-02): Cultures.");
  });
});

describe("renderDraftPrompt", () => {
  const input = {
    payerName: "Northgate Advantage",
    appealFormatNotes: "Reconsideration request within the filing window.",
    conditionLabel: "Sepsis",
    drg: "871",
    category: "medical_necessity" as const,
    rootCauseStatement: "The documentation did not meet inpatient criteria.",
    keyFacts: ["No vasopressor support was required."],
    clauses: [{ id: "C65", code: "SEP-01", text: "Lactate at or above 2.", required: true, score: 0.5, forced: false }],
    precedents: [
      { id: "P25", summary: "A prior CHF appeal was overturned.", letterExcerpt: "x", outcome: "overturned", score: 0.4 },
    ],
    chartText: "L1: HPI:\nL10: SpO2 88% on RA.",
    requiredClauseIds: ["C65"],
  };

  it("puts the criteria block in the system prompt, where it can be cached", () => {
    const { system, user } = renderDraftPrompt(input);
    expect(system).toContain("C65 (SEP-01) [REQUIRED]: Lactate at or above 2.");
    expect(user).not.toContain("Lactate at or above 2.");
  });

  it("puts the case-specific chart in the user message", () => {
    const { user } = renderDraftPrompt(input);
    expect(user).toContain("L10: SpO2 88% on RA.");
  });

  it("includes precedents when there are any", () => {
    expect(renderDraftPrompt(input).user).toContain("P25: A prior CHF appeal was overturned.");
  });

  it("omits the precedent block entirely when there are none", () => {
    const { user } = renderDraftPrompt({ ...input, precedents: [] });
    expect(user).not.toContain("PRECEDENTS");
  });

  it("tells the drafter not to argue a clause it concedes", () => {
    expect(renderDraftPrompt(input).system).toMatch(/must not appear in any `criteria_argument` assertion/);
  });
});
