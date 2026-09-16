import { describe, expect, it } from "vitest";
import { CONDITIONS } from "../../src/lib/domain";
import { CATALOG, criterion } from "../../scripts/seed/catalog";
import {
  assertCriteriaInvariants,
  buildCriteria,
  type CriteriaArtifact,
} from "../../scripts/seed/pass-a-criteria";
import {
  LEAKAGE_SHINGLE,
  containsTerm,
  matchedTerms,
  sharedShingles,
} from "../../scripts/seed/text-checks";

describe("buildCriteria", () => {
  const artifact = buildCriteria();

  it("builds one criteria set per payer and condition", () => {
    expect(artifact.criteriaSets).toHaveLength(12);
  });

  it("assigns sequential clause IDs starting at C1", () => {
    expect(artifact.clauses.map((c) => c.id)).toEqual(
      artifact.clauses.map((_, i) => `C${i + 1}`),
    );
  });

  it("is deterministic across calls", () => {
    expect(buildCriteria()).toEqual(artifact);
  });

  it("gives every set 6 to 9 clauses with 3 to 4 required", () => {
    for (const set of artifact.criteriaSets) {
      const inSet = artifact.clauses.filter((c) => c.setId === set.id);
      const required = inSet.filter((c) => c.required);
      expect(inSet.length, set.id).toBeGreaterThanOrEqual(6);
      expect(inSet.length, set.id).toBeLessThanOrEqual(9);
      expect(required.length, set.id).toBeGreaterThanOrEqual(3);
      expect(required.length, set.id).toBeLessThanOrEqual(4);
    }
  });

  it("gives clause codes unique within each set", () => {
    for (const set of artifact.criteriaSets) {
      const codes = artifact.clauses.filter((c) => c.setId === set.id).map((c) => c.code);
      expect(new Set(codes).size, set.id).toBe(codes.length);
    }
  });

  it("requires the lactate and repeat vitals clause for Northgate sepsis (DEMO-03)", () => {
    const clause = artifact.clauses.find(
      (c) => c.payerId === "northgate" && c.condition === "sepsis" && c.key === "lactate_repeat_vitals",
    );
    expect(clause?.required).toBe(true);
  });

  it("uses each payer's criteria style for clause text", () => {
    const pinnacleHypoxia = artifact.clauses.find(
      (c) => c.payerId === "pinnacle" && c.condition === "chf_exacerbation" && c.key === "hypoxia",
    );
    expect(pinnacleHypoxia?.text).toBe(criterion("chf_exacerbation", "hypoxia").clause.interqual_style);
  });
});

describe("assertCriteriaInvariants", () => {
  it("passes on the built artifact", () => {
    expect(() => assertCriteriaInvariants(buildCriteria())).not.toThrow();
  });

  it("throws when a set has too few required clauses", () => {
    const broken: CriteriaArtifact = structuredClone(buildCriteria());
    for (const clause of broken.clauses) {
      if (clause.setId === "CS-pinnacle-sepsis") clause.required = false;
    }
    expect(() => assertCriteriaInvariants(broken)).toThrow(/CS-pinnacle-sepsis: 0 required/);
  });

  it("throws when a set has no omittable required clause", () => {
    const broken: CriteriaArtifact = structuredClone(buildCriteria());
    for (const clause of broken.clauses) {
      if (clause.setId === "CS-cascade-pneumonia") clause.omittable = false;
    }
    expect(() => assertCriteriaInvariants(broken)).toThrow(/no omittable required clause/);
  });

  it("throws when a payer note is missing for a set", () => {
    const broken: CriteriaArtifact = structuredClone(buildCriteria());
    broken.payerNotes = broken.payerNotes.filter(
      (n) => !(n.payerId === "cascade" && n.condition === "pneumonia"),
    );
    expect(() => assertCriteriaInvariants(broken)).toThrow(/0 payer notes/);
  });
});

describe("CATALOG", () => {
  for (const condition of CONDITIONS) {
    const criteria = CATALOG[condition];

    it(`${condition}: mention term appears in both strong and weak facts`, () => {
      for (const c of criteria) {
        expect(containsTerm(c.strong, c.mention), `${c.key} strong`).toBe(true);
        expect(containsTerm(c.weak, c.mention), `${c.key} weak`).toBe(true);
      }
    });

    it(`${condition}: omittable criteria have omit text and forbid terms, others have neither`, () => {
      for (const c of criteria) {
        if (c.omittable) {
          expect(c.omit, c.key).toBeTruthy();
          expect(c.forbid.length, c.key).toBeGreaterThan(0);
        } else {
          expect(c.omit, c.key).toBeUndefined();
          expect(c.forbid, c.key).toEqual([]);
        }
      }
    });

    it(`${condition}: forbid terms never appear in another criterion's facts`, () => {
      // If they did, documenting that other criterion would make it impossible
      // to also omit this one.
      for (const omitted of criteria.filter((c) => c.omittable)) {
        for (const other of criteria.filter((c) => c.key !== omitted.key)) {
          const hits = matchedTerms(`${other.strong} ${other.weak}`, omitted.forbid);
          expect(hits, `${omitted.key} forbid vs ${other.key} facts`).toEqual([]);
        }
      }
    });

    it(`${condition}: chart facts share no ${LEAKAGE_SHINGLE}-word phrase with any clause text`, () => {
      const clauseTexts = criteria.flatMap((c) => Object.values(c.clause));
      for (const c of criteria) {
        const facts = [c.strong, c.weak, c.omit ?? ""].join(" ");
        expect(sharedShingles(facts, clauseTexts, LEAKAGE_SHINGLE), c.key).toEqual([]);
      }
    });

    it(`${condition}: no em dashes in any authored text`, () => {
      for (const c of criteria) {
        const all = [
          ...Object.values(c.clause),
          c.strong,
          c.weak,
          c.omit ?? "",
          c.payerAssertion,
          c.evidenceNeeded,
        ].join(" ");
        expect(all.includes("—"), c.key).toBe(false);
      }
    });
  }

  it("throws on an unknown criterion key", () => {
    expect(() => criterion("sepsis", "not_a_key")).toThrow(/Unknown criterion/);
  });
});

describe("containsTerm", () => {
  it("matches a whole word", () => {
    expect(containsTerm("BUN 34 mg/dL", "bun")).toBe(true);
  });

  it("does not match a plain term inside a longer word", () => {
    expect(containsTerm("bundle of records", "bun")).toBe(false);
  });

  it("does not match a term preceded by letters", () => {
    expect(containsTerm("NT-proBNP 6,840", "bnp")).toBe(false);
  });

  it("matches a plural of a plain term", () => {
    expect(containsTerm("IV antibiotics through day 3", "antibiotic")).toBe(true);
  });

  it("matches a stem marked with a trailing asterisk", () => {
    expect(containsTerm("Patient confused on arrival", "confus*")).toBe(true);
  });

  it("does not treat an unmarked term as a stem", () => {
    expect(containsTerm("Patient confused on arrival", "confus")).toBe(false);
  });

  it("does not match a whole-word term followed by other letters", () => {
    expect(containsTerm("lactated Ringer's bolus", "lactate")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(containsTerm("spo2 88%", "SpO2")).toBe(true);
  });
});
