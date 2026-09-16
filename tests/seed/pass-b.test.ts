import { describe, expect, it } from "vitest";
import { COST_PER_APPEAL_AI, winRate } from "../../src/lib/economics";
import { buildCriteria } from "../../scripts/seed/pass-a-criteria";
import {
  assertCaseInvariants,
  buildCaseSeeds,
  deadlineDays,
  routeFromSupport,
  triageFromInputs,
  type CaseSeed,
  type CasesArtifact,
} from "../../scripts/seed/pass-b-cases";
import { caseDates, seedAnchor } from "../../scripts/seed/load";
import { createRng } from "../../scripts/seed/rng";

const criteria = buildCriteria();
const artifact = buildCaseSeeds(criteria);
const byId = (id: string): CaseSeed => {
  const found = artifact.cases.find((c) => c.denialId === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const daysLeft = (c: CaseSeed) => deadlineDays(criteria, c.payerId) - c.daysSinceReceived;

describe("buildCaseSeeds", () => {
  it("is deterministic across calls", () => {
    expect(buildCaseSeeds(criteria)).toEqual(artifact);
  });

  it("builds 43 cases: 16 dev, 20 test, 7 demo", () => {
    const count = (split: string) => artifact.cases.filter((c) => c.split === split).length;
    expect(artifact.cases).toHaveLength(43);
    expect(count("dev")).toBe(16);
    expect(count("test")).toBe(20);
    expect(count("demo")).toBe(7);
  });

  it("puts every route in both the dev and test splits", () => {
    for (const split of ["dev", "test"]) {
      const routes = new Set(artifact.cases.filter((c) => c.split === split).map((c) => c.intendedRoute));
      expect([...routes].sort(), split).toEqual(["do_not_appeal", "needs_docs", "needs_review", "ready"]);
    }
  });

  it("numbers generated cases without revealing split order", () => {
    const generated = artifact.cases.filter((c) => c.denialId.startsWith("CASE-"));
    const firstTwenty = generated.slice(0, 20).map((c) => c.split);
    expect(new Set(firstTwenty).size).toBe(2);
  });
});

describe("demo cases (PRD 8.3)", () => {
  it("DEMO-01 is Meridian CHF, $18,500, 41 days left, ready", () => {
    const c = byId("DEMO-01");
    expect([c.payerId, c.condition, c.amount, daysLeft(c), c.intendedRoute]).toEqual([
      "meridian",
      "chf_exacerbation",
      18500,
      41,
      "ready",
    ]);
  });

  it("DEMO-02 is Cascade COPD, $2,400, 60 days left, ready", () => {
    const c = byId("DEMO-02");
    expect([c.payerId, c.condition, c.amount, daysLeft(c), c.intendedRoute]).toEqual([
      "cascade",
      "copd_exacerbation",
      2400,
      60,
      "ready",
    ]);
  });

  it("DEMO-03 is Northgate sepsis, $22,000, needs docs, with the lactate clause unmet", () => {
    const c = byId("DEMO-03");
    expect([c.payerId, c.condition, c.amount, c.intendedRoute]).toEqual([
      "northgate",
      "sepsis",
      22000,
      "needs_docs",
    ]);
    const unmet = c.clauses.filter((x) => x.support === "unmet").map((x) => x.key);
    expect(unmet).toEqual(["lactate_repeat_vitals"]);
  });

  it("DEMO-04 is Meridian pneumonia, $9,800, needs review, with exactly one weak required clause", () => {
    const c = byId("DEMO-04");
    expect([c.payerId, c.condition, c.amount, c.intendedRoute]).toEqual([
      "meridian",
      "pneumonia",
      9800,
      "needs_review",
    ]);
    expect(c.clauses.filter((x) => x.required && x.support === "weak")).toHaveLength(1);
  });

  it("the three pre-triaged rows are demo split with one reason each", () => {
    const rows = ["DNA-01", "DNA-02", "DNA-03"].map(byId);
    expect(rows.map((c) => c.split)).toEqual(["demo", "demo", "demo"]);
    expect(rows.map((c) => c.triage)).toEqual(["expired", "below_ev", "ineligible_category"]);
    expect(rows.every((c) => c.shortChart && c.intendedRoute === "do_not_appeal")).toBe(true);
  });

  it("DNA-01 is on day 184 of a 180-day window", () => {
    const c = byId("DNA-01");
    expect(c.daysSinceReceived).toBe(184);
    expect(deadlineDays(criteria, c.payerId)).toBe(180);
  });

  it("DNA-02 is $700 at the payer floor with EV $266", () => {
    const c = byId("DNA-02");
    const ev = c.amount * winRate(c.payerId, c.category);
    expect(c.amount).toBe(700);
    expect(ev).toBeCloseTo(266, 5);
    expect(ev).toBeLessThan(COST_PER_APPEAL_AI);
  });
});

describe("routeFromSupport", () => {
  const req = (support: "strong" | "weak" | "unmet") => ({ required: true, support });
  const opt = (support: "strong" | "weak" | "absent") => ({ required: false, support });

  it("any triage failure returns do_not_appeal regardless of support", () => {
    expect(routeFromSupport("expired", [req("strong")])).toBe("do_not_appeal");
  });

  it("an unmet required clause returns needs_docs", () => {
    expect(routeFromSupport("appeal", [req("strong"), req("unmet")])).toBe("needs_docs");
  });

  it("unmet outranks weak and returns needs_docs", () => {
    expect(routeFromSupport("appeal", [req("weak"), req("unmet")])).toBe("needs_docs");
  });

  it("a weak required clause returns needs_review", () => {
    expect(routeFromSupport("appeal", [req("strong"), req("weak")])).toBe("needs_review");
  });

  it("all required strong returns ready", () => {
    expect(routeFromSupport("appeal", [req("strong"), req("strong")])).toBe("ready");
  });

  it("weak or absent non-required clauses do not change a ready route", () => {
    expect(routeFromSupport("appeal", [req("strong"), opt("weak"), opt("absent")])).toBe("ready");
  });
});

describe("triageFromInputs", () => {
  const base = {
    eligible: true,
    payerId: "meridian" as const,
    category: "medical_necessity" as const,
    daysSinceReceived: 30,
    amount: 10000,
  };

  it("returns appeal when eligible, in window, and above the EV threshold", () => {
    expect(triageFromInputs(base, criteria)).toBe("appeal");
  });

  it("returns account_flagged when the account is not eligible", () => {
    expect(triageFromInputs({ ...base, eligible: false }, criteria)).toBe("account_flagged");
  });

  it("returns ineligible_category when the payer does not accept that category", () => {
    expect(
      triageFromInputs({ ...base, payerId: "northgate", category: "level_of_care" }, criteria),
    ).toBe("ineligible_category");
  });

  it("returns expired when days left is exactly zero", () => {
    expect(triageFromInputs({ ...base, daysSinceReceived: 180 }, criteria)).toBe("expired");
  });

  it("returns appeal with one day left", () => {
    expect(triageFromInputs({ ...base, daysSinceReceived: 179 }, criteria)).toBe("appeal");
  });

  it("returns below_ev when EV equals the threshold exactly", () => {
    // Meridian level_of_care is 0.55, and 500 x 0.55 is exactly 275 in floating
    // point. The PRD rule is appeal only when EV is strictly greater.
    expect(
      triageFromInputs({ ...base, category: "level_of_care", amount: 500 }, criteria),
    ).toBe("below_ev");
  });

  it("returns appeal when EV is one dollar of amount above the threshold", () => {
    expect(
      triageFromInputs({ ...base, category: "level_of_care", amount: 501 }, criteria),
    ).toBe("appeal");
  });
});

describe("assertCaseInvariants", () => {
  it("passes on the built artifact", () => {
    expect(() => assertCaseInvariants(artifact, criteria)).not.toThrow();
  });

  it("throws when a demo case drifts from PRD 8.3", () => {
    const broken: CasesArtifact = structuredClone(artifact);
    broken.cases.find((c) => c.denialId === "DEMO-01")!.amount = 18000;
    expect(() => assertCaseInvariants(broken, criteria)).toThrow(/DEMO-01 does not match PRD 8.3/);
  });

  it("throws when stored triage disagrees with economics", () => {
    const broken: CasesArtifact = structuredClone(artifact);
    broken.cases.find((c) => c.denialId === "DNA-02")!.amount = 5000;
    expect(() => assertCaseInvariants(broken, criteria)).toThrow(/DNA-02: triage below_ev but inputs give appeal/);
  });

  it("throws when a non-omittable clause is marked unmet", () => {
    const broken: CasesArtifact = structuredClone(artifact);
    const clause = broken.cases
      .find((c) => c.denialId === "DEMO-01")!
      .clauses.find((x) => x.key === "hypoxia")!;
    clause.support = "unmet";
    expect(() => assertCaseInvariants(broken, criteria)).toThrow(/omitted but not omittable/);
  });

  it("throws when a ready case carries weak evidence", () => {
    const broken: CasesArtifact = structuredClone(artifact);
    const demo = broken.cases.find((c) => c.denialId === "DEMO-01")!;
    demo.clauses.find((x) => x.key === "bnp")!.support = "weak";
    expect(() => assertCaseInvariants(broken, criteria)).toThrow(/ready case has weak evidence/);
  });
});

describe("caseDates", () => {
  it("anchors dates so days since received matches the seed", () => {
    const anchor = seedAnchor(new Date("2026-09-16T15:30:00Z"));
    const c = byId("DEMO-01");
    const { received, discharge, admit } = caseDates(c, anchor);
    const dayMs = 86_400_000;
    expect((anchor.getTime() - received.getTime()) / dayMs).toBe(139);
    expect((received.getTime() - discharge.getTime()) / dayMs).toBe(c.dischargeToDenialDays);
    expect((discharge.getTime() - admit.getTime()) / dayMs).toBe(c.patient.losDays);
  });

  it("seedAnchor truncates to midnight UTC", () => {
    expect(seedAnchor(new Date("2026-09-16T23:59:59Z")).toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });
});

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("int stays within inclusive bounds", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it("int throws when max is below min", () => {
    expect(() => createRng(1).int(5, 3)).toThrow(/below min/);
  });
});
