import { describe, expect, it } from "vitest";
import { normalize, resolveFlagTarget, resolveFlagTargets, type AssertionRef } from "../../src/lib/flagged";

/**
 * The shapes here are taken from real judge output on seeded runs, not
 * invented: exact quotes, mid-sentence ellipses, clause-code prefixes and
 * outright paraphrases all occur, and only about one flag in four comes back
 * as an exact string.
 */
const ASSERTIONS: AssertionRef[] = [
  {
    id: "a-0-0",
    text: "Triage vital signs recorded a temperature of 39.4 C, and the white blood cell count was 21,300 with 14 percent bands.",
  },
  {
    id: "a-1-0",
    text: "SEP-01: Hypotension persisting after that fluid challenge required peripheral norepinephrine to be started at 03:20, a vasopressor intervention that cannot be delivered in an observation setting.",
  },
  {
    id: "a-1-1",
    text: "SEP-03: Contrary to the payer's statement that there was no evidence of new organ dysfunction, admission labs recorded a creatinine of 2.6 mg/dL against a documented baseline of 0.9 mg/dL.",
  },
  {
    id: "a-2-0",
    text: "Blood cultures turned positive for E. coli at 30 hours, with the urine culture growing the same organism.",
  },
];

describe("normalize", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalize("  Creatinine 2.6 mg/dL,  baseline 0.9! ")).toBe("creatinine 2 6 mg dl baseline 0 9");
  });
});

describe("resolveFlagTarget", () => {
  it("matches an exact quote", () => {
    expect(resolveFlagTarget(ASSERTIONS[2].text, ASSERTIONS)).toBe("a-1-1");
  });

  it("matches when only whitespace and case differ", () => {
    const noisy = `   ${ASSERTIONS[0].text.toUpperCase().replace(/ /g, "  ")}  `;
    expect(resolveFlagTarget(noisy, ASSERTIONS)).toBe("a-0-0");
  });

  it("matches a quote truncated in the middle by an ellipsis", () => {
    const flag =
      "Peripheral norepinephrine was started at 03:20 for persistent hypotension. ... a vasopressor intervention that cannot be delivered in an observation setting.";
    expect(resolveFlagTarget(flag, ASSERTIONS)).toBe("a-1-0");
  });

  it("matches a quote that opens with an ellipsis", () => {
    const flag = "...admission labs recorded a creatinine of 2.6 mg/dL against a documented baseline of 0.9 mg/dL.";
    expect(resolveFlagTarget(flag, ASSERTIONS)).toBe("a-1-1");
  });

  it("matches when the judge prefixes the clause code the assertion omits", () => {
    const flag = "SEP-02: Blood cultures turned positive for E. coli at 30 hours, with the urine culture growing the same organism.";
    expect(resolveFlagTarget(flag, ASSERTIONS)).toBe("a-2-0");
  });

  it("matches a paraphrase that keeps the distinctive words", () => {
    const flag = "The claim that norepinephrine, a vasopressor intervention, cannot be delivered in an observation setting after the fluid challenge.";
    expect(resolveFlagTarget(flag, ASSERTIONS)).toBe("a-1-0");
  });

  it("picks the assertion the flag is actually about, not a similar one", () => {
    const flag = "...creatinine of 2.6 mg/dL against a documented baseline of 0.9 mg/dL.";
    expect(resolveFlagTarget(flag, ASSERTIONS)).toBe("a-1-1");
  });

  it("returns null rather than guessing when nothing is close", () => {
    expect(resolveFlagTarget("The letter omits a physician attestation line entirely.", ASSERTIONS)).toBeNull();
  });

  it("returns null on a fragment too short to be distinctive", () => {
    expect(resolveFlagTarget("...the patient.", ASSERTIONS)).toBeNull();
  });

  it("returns null when there are no assertions", () => {
    expect(resolveFlagTarget(ASSERTIONS[0].text, [])).toBeNull();
  });
});

describe("resolveFlagTargets", () => {
  it("resolves each flag and collects the flagged assertion ids", () => {
    const { targets, flaggedIds } = resolveFlagTargets(
      [ASSERTIONS[0].text, "...a vasopressor intervention that cannot be delivered in an observation setting."],
      ASSERTIONS,
    );
    expect(targets).toEqual(["a-0-0", "a-1-0"]);
    expect([...flaggedIds].sort()).toEqual(["a-0-0", "a-1-0"]);
  });

  it("keeps an unresolved flag as null without dropping the others", () => {
    const { targets, flaggedIds } = resolveFlagTargets(["nothing like any assertion here at all", ASSERTIONS[3].text], ASSERTIONS);
    expect(targets).toEqual([null, "a-2-0"]);
    expect(flaggedIds.has("a-2-0")).toBe(true);
    expect(flaggedIds.size).toBe(1);
  });
});
