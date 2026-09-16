import { describe, expect, it } from "vitest";
import { buildCriteria } from "../../scripts/seed/pass-a-criteria";
import { buildCaseSeeds, type CaseSeed } from "../../scripts/seed/pass-b-cases";
import {
  SPOT_CHECK_COUNT,
  applySpotChecks,
  deriveAll,
  deriveGroundTruth,
  spotCheckSelection,
  type GroundTruthRecord,
} from "../../scripts/seed/pass-e-truth";

const criteria = buildCriteria();
const { cases } = buildCaseSeeds(criteria);
const seedFor = (id: string): CaseSeed => cases.find((c) => c.denialId === id)!;
const truthFor = (id: string): GroundTruthRecord => deriveGroundTruth(seedFor(id), criteria);

describe("deriveGroundTruth", () => {
  it("labels DEMO-01 ready, winnable, approve as is", () => {
    const t = truthFor("DEMO-01");
    expect(t.expectedRoute).toBe("ready");
    expect(t.winnable).toBe(true);
    expect(t.approveAsIs).toBe(true);
    expect(t.unmetRequiredClauseIds).toEqual([]);
  });

  it("labels DEMO-03 needs docs, not winnable, with the unmet clause listed", () => {
    const t = truthFor("DEMO-03");
    const lactate = seedFor("DEMO-03").clauses.find((c) => c.key === "lactate_repeat_vitals")!;
    expect(t.expectedRoute).toBe("needs_docs");
    expect(t.winnable).toBe(false);
    expect(t.approveAsIs).toBe(false);
    expect(t.unmetRequiredClauseIds).toEqual([lactate.clauseId]);
  });

  it("labels DEMO-04 needs review, winnable but not approve as is", () => {
    const t = truthFor("DEMO-04");
    expect(t.expectedRoute).toBe("needs_review");
    expect(t.winnable).toBe(true);
    expect(t.approveAsIs).toBe(false);
  });

  it("labels an expired case do not appeal while keeping it winnable", () => {
    const t = truthFor("DNA-01");
    expect(t.expectedRoute).toBe("do_not_appeal");
    expect(t.winnable).toBe(true);
  });

  it("counts weak clauses as met", () => {
    const t = truthFor("DEMO-04");
    const weak = seedFor("DEMO-04").clauses.filter((c) => c.support === "weak");
    expect(weak.length).toBeGreaterThan(0);
    for (const clause of weak) expect(t.metClauseIds).toContain(clause.clauseId);
  });

  it("excludes absent clauses from met", () => {
    const t = truthFor("DEMO-01");
    const absent = seedFor("DEMO-01").clauses.filter((c) => c.support === "absent");
    expect(absent.length).toBeGreaterThan(0);
    for (const clause of absent) expect(t.metClauseIds).not.toContain(clause.clauseId);
  });

  it("carries the seed's category and root cause", () => {
    const seed = seedFor("DEMO-02");
    const t = truthFor("DEMO-02");
    expect([t.category, t.rootCause]).toEqual([seed.category, seed.rootCause]);
  });
});

describe("deriveAll", () => {
  it("agrees with every case seed's intended route", () => {
    const records = deriveAll(cases, criteria);
    expect(records).toHaveLength(cases.length);
    for (const [i, record] of records.entries()) {
      expect(record.expectedRoute, record.denialId).toBe(cases[i].intendedRoute);
    }
  });

  it("throws when the derived route disagrees with the seed", () => {
    const tampered = structuredClone(cases);
    tampered.find((c) => c.denialId === "DEMO-01")!.intendedRoute = "needs_docs";
    expect(() => deriveAll(tampered, criteria)).toThrow(/DEMO-01: seed intended needs_docs, derived ready/);
  });

  it("labels exactly the cases with no unmet required clause as winnable", () => {
    for (const record of deriveAll(cases, criteria)) {
      expect(record.winnable, record.denialId).toBe(record.unmetRequiredClauseIds.length === 0);
    }
  });
});

describe("spotCheckSelection", () => {
  const selection = spotCheckSelection(cases);

  it("selects 8 cases", () => {
    expect(selection).toHaveLength(SPOT_CHECK_COUNT);
  });

  it("includes all four demo cases", () => {
    expect(selection.slice(0, 4)).toEqual(["DEMO-01", "DEMO-02", "DEMO-03", "DEMO-04"]);
  });

  it("draws the rest from the dev and test splits", () => {
    for (const id of selection.slice(4)) {
      expect(seedFor(id).split, id).not.toBe("demo");
    }
  });

  it("is deterministic", () => {
    expect(spotCheckSelection(cases)).toEqual(selection);
  });
});

describe("applySpotChecks", () => {
  const records = deriveAll(cases, criteria);

  it("leaves labels untouched when no file exists", () => {
    expect(applySpotChecks(records, undefined)).toEqual(records);
  });

  it("leaves a case unchecked when the reviewer has not confirmed it", () => {
    const out = applySpotChecks(records, { cases: [{ denialId: "DEMO-01", checked: false, note: "" }] });
    expect(out.find((r) => r.denialId === "DEMO-01")!.spotChecked).toBe(false);
  });

  it("marks a confirmed case checked and records the note", () => {
    const out = applySpotChecks(records, {
      cases: [{ denialId: "DEMO-01", checked: true, note: "Chart supports every required clause." }],
    });
    const record = out.find((r) => r.denialId === "DEMO-01")!;
    expect(record.spotChecked).toBe(true);
    expect(record.spotCheckNote).toBe("Chart supports every required clause.");
    expect(record.expectedRoute).toBe("ready");
  });

  it("applies a reviewer's correction", () => {
    const out = applySpotChecks(records, {
      cases: [
        {
          denialId: "DEMO-04",
          checked: true,
          note: "Hypoxia evidence is weaker than labeled.",
          corrections: { expectedRoute: "needs_docs", approveAsIs: false },
        },
      ],
    });
    expect(out.find((r) => r.denialId === "DEMO-04")!.expectedRoute).toBe("needs_docs");
  });

  it("throws when the file names an unknown case", () => {
    expect(() => applySpotChecks(records, { cases: [{ denialId: "CASE-999", checked: true, note: "" }] })).toThrow(
      /unknown case CASE-999/,
    );
  });
});
