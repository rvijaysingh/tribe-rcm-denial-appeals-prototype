import { describe, expect, it } from "vitest";
import {
  checkClassify,
  renderClassifyPrompt,
  type ClassifyOutput,
} from "../../src/lib/pipeline/b-classify";

const valid: ClassifyOutput = {
  category: "medical_necessity",
  root_cause: "severity_not_documented",
  key_facts: ["Payer says severity was not documented.", "Cites CHF-01.", "Cites CHF-03."],
  confidence: 0.9,
};

describe("checkClassify", () => {
  it("accepts a well-formed classification", () => {
    expect(checkClassify(valid)).toBeNull();
  });

  it("rejects a root cause that belongs to the other category", () => {
    // los_exceeds_expected is a level_of_care argument only.
    const result = checkClassify({ ...valid, root_cause: "los_exceeds_expected" });
    expect(result).toMatch(/not valid for category "medical_necessity"/);
    expect(result).toMatch(/Allowed: severity_not_documented/);
  });

  it("accepts a root cause shared by both categories", () => {
    expect(checkClassify({ ...valid, root_cause: "treatment_appropriate_at_lower_level" })).toBeNull();
    expect(
      checkClassify({
        ...valid,
        category: "level_of_care",
        root_cause: "treatment_appropriate_at_lower_level",
      }),
    ).toBeNull();
  });

  it("rejects fewer than three key facts", () => {
    expect(checkClassify({ ...valid, key_facts: ["one", "two"] })).toMatch(/key_facts has 2 entries/);
  });

  it("rejects more than six key facts", () => {
    expect(checkClassify({ ...valid, key_facts: Array(7).fill("fact") })).toMatch(/key_facts has 7 entries/);
  });

  it("accepts exactly three and exactly six", () => {
    expect(checkClassify({ ...valid, key_facts: Array(3).fill("fact") })).toBeNull();
    expect(checkClassify({ ...valid, key_facts: Array(6).fill("fact") })).toBeNull();
  });

  it("rejects an empty key fact", () => {
    expect(checkClassify({ ...valid, key_facts: ["a", "   ", "c"] })).toMatch(/empty entry/);
  });

  it.each([-0.1, 1.1, Number.NaN])("rejects confidence %s", (confidence) => {
    expect(checkClassify({ ...valid, confidence })).toMatch(/confidence/);
  });

  it("accepts confidence at both bounds", () => {
    expect(checkClassify({ ...valid, confidence: 0 })).toBeNull();
    expect(checkClassify({ ...valid, confidence: 1 })).toBeNull();
  });

  it("reports every problem at once so one retry can fix them all", () => {
    const result = checkClassify({ ...valid, root_cause: "los_exceeds_expected", key_facts: [], confidence: 3 });
    expect(result).toMatch(/not valid for category/);
    expect(result).toMatch(/key_facts has 0 entries/);
    expect(result).toMatch(/confidence 3/);
  });
});

describe("renderClassifyPrompt", () => {
  const input = {
    conditionLabel: "Sepsis",
    carc: "CO-50",
    rarc: "N115",
    docTypes: ["hp", "progress", "progress", "discharge"] as const,
    letterText: "  Northgate Advantage has denied this admission.  ",
  };

  it("includes the denial letter and the codes", () => {
    const { user } = renderClassifyPrompt({ ...input, docTypes: [...input.docTypes] });
    expect(user).toContain("Northgate Advantage has denied this admission.");
    expect(user).toContain("CARC CO-50, RARC N115");
    expect(user).toContain("Sepsis");
  });

  it("lists each document type once, in readable form", () => {
    const { user } = renderClassifyPrompt({ ...input, docTypes: [...input.docTypes] });
    expect(user).toContain("history and physical, progress note, discharge summary");
  });

  it("names the allowed root causes per category in the system prompt", () => {
    const { system } = renderClassifyPrompt({ ...input, docTypes: [...input.docTypes] });
    expect(system).toContain("severity_not_documented");
    expect(system).toContain("los_exceeds_expected");
  });

  it("tells the model it is not being shown the chart", () => {
    const { system } = renderClassifyPrompt({ ...input, docTypes: [...input.docTypes] });
    expect(system).toMatch(/not the chart itself/);
  });
});
