import { describe, expect, it } from "vitest";
import { CALENDAR_DATE, PERSON_NAME, normalizeDashes } from "../../scripts/seed/text-checks";

describe("CALENDAR_DATE", () => {
  it.each(["3/14/2026", "admitted in 2026", "diagnosed 1998", "seen March 14", "Dec. 3"])(
    "matches a date or year: %s",
    (text) => {
      expect(CALENDAR_DATE.test(text)).toBe(true);
    },
  );

  it.each([
    "BP 118/72",
    "2000 mL NS bolus",
    "urine 2000 ml/day",
    "2020 units heparin",
    "may 3 doses be given",
    "O2 decreased 2L",
    "platelets 84,000",
    "marked 3+ edema",
  ])("does not match clinical text: %s", (text) => {
    expect(CALENDAR_DATE.test(text)).toBe(false);
  });
});

describe("PERSON_NAME", () => {
  it("matches an honorific and a name", () => {
    expect(PERSON_NAME.test("Discussed with Dr. Alvarez")).toBe(true);
  });

  it("does not match a role title", () => {
    expect(PERSON_NAME.test("Discussed with attending and RN")).toBe(false);
  });
});

describe("normalizeDashes", () => {
  it("replaces an em dash with a spaced hyphen and an en dash with a hyphen", () => {
    expect(normalizeDashes("fever — 3–4 days")).toBe("fever - 3-4 days");
  });
});
