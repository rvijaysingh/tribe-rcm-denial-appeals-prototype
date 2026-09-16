import { describe, expect, it } from "vitest";
import { PAYER_HISTORY_WARN_THRESHOLD, WIN_RATE } from "../../src/lib/economics";
import { buildCriteria } from "../../scripts/seed/pass-a-criteria";
import { buildCaseSeeds, type CaseSeed } from "../../scripts/seed/pass-b-cases";
import {
  DATE_TOKENS,
  checkLetter,
  checkPrecedents,
  citedClauses,
  fillLetter,
  letterInputs,
  precedentCounts,
  precedentPlan,
  renderLetterPrompt,
  type LetterOutput,
  type PrecedentOutput,
} from "../../scripts/seed/pass-d-letters";
import { LEAKAGE_SHINGLE, sharedShingles } from "../../scripts/seed/text-checks";

const criteria = buildCriteria();
const { cases } = buildCaseSeeds(criteria);
const seedFor = (id: string): CaseSeed => cases.find((c) => c.denialId === id)!;

/** A letter that satisfies every rule for a case, built from its inputs. */
function goodLetter(seed: CaseSeed): LetterOutput {
  const i = letterInputs(seed, criteria);
  const findings = i.cited.map((c) => `Criterion ${c.code}: ${c.finding}`).join("\n");
  const filler =
    "This determination was made by a physician reviewer after review of the clinical information submitted with the claim. " +
    "The attending physician may request a peer to peer discussion by calling the number on the member card during business hours. " +
    "This letter does not affect the member's eligibility for other covered services under the plan, and the member retains all rights described in the evidence of coverage. " +
    "Copies of the documents used in this review are available on request at no cost to the member or the provider.";
  return {
    letter_text: [
      `[[LETTER_DATE]]`,
      `RE: Adverse determination for ${i.categoryLabel}`,
      `Member ID: ${i.memberId}  Claim: ${i.claimNumber}`,
      `Dates of service: [[ADMIT_DATE]] through [[DISCHARGE_DATE]]`,
      `Adjustment codes: CARC ${i.carc}, RARC ${i.rarc}`,
      `${i.payerName} reviewed this inpatient stay against its ${i.criteriaLabel} criteria set. ${i.rootCauseStatement}`,
      findings,
      filler,
      `${i.appealInstructions} Appeals must be received by [[APPEAL_DEADLINE]].`,
      `Medical Director, Utilization Management`,
    ].join("\n\n"),
  };
}

describe("citedClauses", () => {
  it("cites the unmet required clause for DEMO-03", () => {
    const cited = citedClauses(seedFor("DEMO-03"));
    expect(cited.map((c) => c.key)).toContain("lactate_repeat_vitals");
  });

  it("cites the weak required clause for DEMO-04", () => {
    const cited = citedClauses(seedFor("DEMO-04"));
    expect(cited.map((c) => c.key)).toContain("hypoxia");
  });

  it("cites two to three required clauses for every case", () => {
    for (const seed of cases) {
      const cited = citedClauses(seed);
      expect(cited.length, seed.denialId).toBeGreaterThanOrEqual(2);
      expect(cited.length, seed.denialId).toBeLessThanOrEqual(3);
      expect(cited.every((c) => c.required), seed.denialId).toBe(true);
    }
  });

  it("is deterministic per case", () => {
    expect(citedClauses(seedFor("CASE-020"))).toEqual(citedClauses(seedFor("CASE-020")));
  });
});

describe("renderLetterPrompt (anti-leakage)", () => {
  it("never contains clause text for any case", () => {
    for (const seed of cases) {
      const { system, user } = renderLetterPrompt(letterInputs(seed, criteria));
      const clauseTexts = criteria.clauses
        .filter((c) => c.payerId === seed.payerId && c.condition === seed.condition)
        .map((c) => c.text);
      expect(sharedShingles(`${system}\n${user}`, clauseTexts, LEAKAGE_SHINGLE), seed.denialId).toEqual([]);
    }
  });

  it("never reveals the chart support levels or the expected route", () => {
    for (const seed of cases) {
      const { user } = renderLetterPrompt(letterInputs(seed, criteria));
      expect(/\b(strong|weak|unmet|absent|needs_docs|needs_review|ready|do_not_appeal)\b/i.test(user), seed.denialId).toBe(
        false,
      );
    }
  });
});

describe("checkLetter", () => {
  const seed = seedFor("DEMO-03");

  it("accepts a letter that meets every rule", () => {
    expect(checkLetter(goodLetter(seed), seed, criteria)).toBeNull();
  });

  it("rejects a letter missing a date token", () => {
    const letter = goodLetter(seed);
    letter.letter_text = letter.letter_text.replace("[[APPEAL_DEADLINE]]", "the deadline");
    expect(checkLetter(letter, seed, criteria)).toMatch(/missing date token \[\[APPEAL_DEADLINE\]\]/);
  });

  it("rejects a real calendar date", () => {
    const letter = goodLetter(seed);
    letter.letter_text += "\nReceived 04/02/2026.";
    expect(checkLetter(letter, seed, criteria)).toMatch(/calendar date or year/);
  });

  it("does not flag the criteria version, which looks like a year", () => {
    const letter = goodLetter(seed);
    letter.letter_text += "\nCriteria set version 2026.1 was applied.";
    expect(checkLetter(letter, seed, criteria)).toBeNull();
  });

  it("rejects a letter that contradicts its determination type", () => {
    const letter = goodLetter(seed);
    letter.letter_text += "\nThis determination applies to the level of care only.";
    expect(checkLetter(letter, seed, criteria)).toMatch(/medical necessity determination, but the letter says/);
  });

  it("allows the payer boilerplate about level of care appeals", () => {
    const letter = goodLetter(seed);
    letter.letter_text += "\nLevel of care denials are not eligible for provider appeal.";
    expect(checkLetter(letter, seed, criteria)).toBeNull();
  });

  it("rejects a criteria code that was not provided", () => {
    const letter = goodLetter(seed);
    letter.letter_text += "\nSee also SEP-09.";
    expect(checkLetter(letter, seed, criteria)).toMatch(/not provided: SEP-09/);
  });

  it("rejects a letter that omits a cited code", () => {
    const letter = goodLetter(seed);
    const code = letterInputs(seed, criteria).cited[0].code;
    letter.letter_text = letter.letter_text.split(code).join("the criterion");
    expect(checkLetter(letter, seed, criteria)).toMatch(new RegExp(`missing cited criteria code ${code}`));
  });

  it("rejects a letter that quotes clause text", () => {
    const letter = goodLetter(seed);
    const clause = criteria.clauses.find((c) => c.payerId === "northgate" && c.condition === "sepsis")!;
    letter.letter_text += `\n${clause.text}`;
    expect(checkLetter(letter, seed, criteria)).toMatch(/paraphrases criteria text/);
  });

  it("rejects a missing CARC", () => {
    const letter = goodLetter(seed);
    letter.letter_text = letter.letter_text.split("CO-50").join("");
    expect(checkLetter(letter, seed, criteria)).toMatch(/missing "CO-50"/);
  });
});

describe("fillLetter", () => {
  const dates = {
    received: new Date("2026-07-01T00:00:00Z"),
    admit: new Date("2026-06-10T00:00:00Z"),
    discharge: new Date("2026-06-15T00:00:00Z"),
  };

  it("fills every date token and computes the deadline from the payer window", () => {
    const filled = fillLetter(DATE_TOKENS.join(" "), dates, 90);
    expect(filled).toBe("07/01/2026 06/10/2026 06/15/2026 09/29/2026");
  });

  it("throws on an unknown token", () => {
    expect(() => fillLetter("Sent [[SEND_DATE]]", dates, 90)).toThrow(/unknown token \[\[SEND_DATE\]\]/);
  });
});

describe("precedentCounts", () => {
  it("keeps every payer and category within 4 to 6 precedents", () => {
    for (const byCategory of Object.values(WIN_RATE)) {
      for (const rate of Object.values(byCategory)) {
        const { count } = precedentCounts(rate);
        expect(count).toBeGreaterThanOrEqual(4);
        expect(count).toBeLessThanOrEqual(6);
      }
    }
  });

  it("keeps the overturn share on the same side of the payer-history threshold as WIN_RATE", () => {
    for (const byCategory of Object.values(WIN_RATE)) {
      for (const rate of Object.values(byCategory)) {
        const { count, overturned } = precedentCounts(rate);
        expect(overturned / count < PAYER_HISTORY_WARN_THRESHOLD, `rate ${rate}`).toBe(
          rate < PAYER_HISTORY_WARN_THRESHOLD,
        );
      }
    }
  });

  it("puts Northgate medical necessity below 40% (2 of 6)", () => {
    expect(precedentCounts(WIN_RATE.northgate.medical_necessity)).toEqual({ count: 6, overturned: 2 });
  });

  it("does not flag a 0.42 rate even though 2 of 5 is exactly 40%", () => {
    const { count, overturned } = precedentCounts(0.42);
    expect(overturned / count).toBeGreaterThanOrEqual(PAYER_HISTORY_WARN_THRESHOLD);
  });
});

describe("precedentPlan", () => {
  const plan = precedentPlan();

  it("has one group per payer and category", () => {
    expect(plan).toHaveLength(6);
  });

  it("assigns unique sequential IDs", () => {
    const ids = plan.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toEqual(ids.map((_, n) => `P${n + 1}`));
  });

  it("matches outcome counts to the group plan", () => {
    for (const g of plan) {
      expect(g.items.filter((i) => i.outcome === "overturned")).toHaveLength(g.overturned);
      expect(g.items).toHaveLength(g.count);
    }
  });

  it("is deterministic", () => {
    expect(precedentPlan()).toEqual(plan);
  });
});

describe("checkPrecedents", () => {
  const group = precedentPlan()[0];
  const entry = (outcome: string) => ({
    summary: `A heart failure admission was denied for lack of documented severity. The appeal presented saturation readings and diuretic escalation records, and the payer ${outcome} the denial after review of the full record.`,
    letter_excerpt:
      "We respectfully request reconsideration of this determination. The record shows that the patient required escalating therapy that could not be delivered safely outside the hospital, and the documentation submitted with this appeal describes the clinical findings at the time of the admission decision. We ask the reviewer to consider the complete timeline of care rather than the discharge summary alone.",
  });
  const good = (): PrecedentOutput => ({ precedents: group.items.map((i) => entry(i.outcome)) });

  it("accepts entries that state the planned outcome", () => {
    expect(checkPrecedents(good(), group)).toBeNull();
  });

  it("rejects an entry that states the wrong outcome", () => {
    const output = good();
    const index = group.items.findIndex((i) => i.outcome === "overturned");
    output.precedents[index] = entry("upheld");
    expect(checkPrecedents(output, group)).toMatch(new RegExp(`entry ${index + 1} summary must say "overturned"`));
  });

  it("rejects the wrong number of entries", () => {
    const output = good();
    output.precedents.pop();
    expect(checkPrecedents(output, group)).toMatch(/expected \d entries/);
  });
});
