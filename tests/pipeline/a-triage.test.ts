import { describe, expect, it } from "vitest";
import {
  COST_PER_APPEAL_AI,
  COST_PER_APPEAL_MANUAL,
  OLD_CAPACITY_CUTOFF,
  WIN_RATE,
} from "../../src/lib/economics";
import { toCents } from "../../src/lib/money";
import { daysBetween, triage, type TriageInput } from "../../src/lib/pipeline/a-triage";

const NOW = new Date("2026-09-16T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** Pinnacle medical necessity, 0.62, 180 day window. Comfortably appealable. */
const base: TriageInput = {
  payerId: "pinnacle",
  category: "medical_necessity",
  amount: "18500.00",
  receivedDate: daysAgo(139),
  deadlineDays: 180,
  eligible: true,
};

describe("daysBetween", () => {
  it("counts whole days on UTC boundaries", () => {
    expect(daysBetween(new Date("2026-09-01T23:59:00Z"), new Date("2026-09-02T00:01:00Z"))).toBe(1);
  });

  it("is zero within the same UTC day regardless of time", () => {
    expect(daysBetween(new Date("2026-09-02T00:01:00Z"), new Date("2026-09-02T23:59:00Z"))).toBe(0);
  });

  it("is negative for a future date", () => {
    expect(daysBetween(new Date("2026-09-10T00:00:00Z"), new Date("2026-09-08T00:00:00Z"))).toBe(-2);
  });
});

describe("triage: appeal path", () => {
  it("appeals when eligible, in window, and above the EV threshold", () => {
    const out = triage(base, NOW);
    expect(out.decision).toBe("appeal");
    expect(out.reason_code).toBe("appealable");
  });

  it("reports days left from the payer window", () => {
    expect(triage(base, NOW).days_left).toBe(41);
  });

  it("reports expected value in dollars and cents", () => {
    const out = triage(base, NOW);
    expect(out.expected_value).toBe(11470);
    expect(out.expected_value_cents).toBe(1147000);
    expect(out.p_overturn).toBe(WIN_RATE.pinnacle.medical_necessity);
  });

  it("explains the decision with the numbers behind it", () => {
    expect(triage(base, NOW).reason).toBe(
      "Expected value $11,470.00 ($18,500.00 x 0.62) clears the $300.00 cost to work it, with 41 days left to file.",
    );
  });
});

describe("triage: do-not-appeal branches", () => {
  it("refuses a flagged account before anything else", () => {
    const out = triage({ ...base, eligible: false }, NOW);
    expect([out.decision, out.reason_code]).toEqual(["do_not_appeal", "account_flagged"]);
  });

  it("refuses a category the payer does not accept", () => {
    const out = triage({ ...base, payerId: "northgate", category: "level_of_care" }, NOW);
    expect(out.reason_code).toBe("ineligible_category");
  });

  it("refuses an expired window and says how late it is", () => {
    const out = triage({ ...base, receivedDate: daysAgo(184) }, NOW);
    expect([out.decision, out.reason_code, out.days_left]).toEqual(["do_not_appeal", "expired", -4]);
    expect(out.reason).toContain("closed 4 day(s) ago");
  });

  it("refuses a denial whose EV does not clear the cost to work it", () => {
    const out = triage(
      { ...base, payerId: "northgate", amount: "700.00", deadlineDays: 90, receivedDate: daysAgo(30) },
      NOW,
    );
    expect([out.decision, out.reason_code, out.expected_value]).toEqual(["do_not_appeal", "below_ev", 266]);
  });

  it("prefers the flagged-account reason over an expired window", () => {
    const out = triage({ ...base, eligible: false, receivedDate: daysAgo(400) }, NOW);
    expect(out.reason_code).toBe("account_flagged");
  });

  it("prefers the ineligible-category reason over a below-threshold amount", () => {
    const out = triage(
      { ...base, payerId: "northgate", category: "level_of_care", amount: "100.00" },
      NOW,
    );
    expect(out.reason_code).toBe("ineligible_category");
  });
});

describe("triage: boundaries", () => {
  it("does not appeal when EV equals the threshold exactly", () => {
    // Cascade level_of_care is 0.48, and $625.00 x 0.48 is exactly $300.00.
    const out = triage({ ...base, payerId: "cascade", category: "level_of_care", amount: "625.00" }, NOW);
    expect(out.expected_value_cents).toBe(toCents(COST_PER_APPEAL_AI));
    expect(out.decision).toBe("do_not_appeal");
  });

  it("appeals one cent above the threshold", () => {
    const out = triage({ ...base, payerId: "cascade", category: "level_of_care", amount: "625.03" }, NOW);
    expect(out.expected_value_cents).toBe(toCents(COST_PER_APPEAL_AI) + 1);
    expect(out.decision).toBe("appeal");
  });

  it("does not appeal on the day the window closes", () => {
    const out = triage({ ...base, receivedDate: daysAgo(180) }, NOW);
    expect([out.days_left, out.decision]).toEqual([0, "do_not_appeal"]);
  });

  it("appeals with one day left", () => {
    const out = triage({ ...base, receivedDate: daysAgo(179) }, NOW);
    expect([out.days_left, out.decision]).toEqual([1, "appeal"]);
  });

  it("is unaffected by the time of day the denial arrived", () => {
    const morning = triage({ ...base, receivedDate: new Date("2026-05-30T00:01:00Z") }, NOW);
    const evening = triage({ ...base, receivedDate: new Date("2026-05-30T23:59:00Z") }, NOW);
    expect(morning.days_left).toBe(evening.days_left);
  });
});

describe("triage: would_have_been_worked_old", () => {
  it("is true for a large denial that also clears the manual cost", () => {
    expect(triage(base, NOW).would_have_been_worked_old).toBe(true);
  });

  it("is false below the old capacity cutoff even when EV clears the manual cost", () => {
    // DEMO-02: $2,400 at 0.48 is EV $1,152, above $735, but under the $5,000 cutoff.
    const out = triage(
      { ...base, payerId: "cascade", category: "level_of_care", amount: "2400.00", deadlineDays: 120, receivedDate: daysAgo(60) },
      NOW,
    );
    expect(out.expected_value).toBeGreaterThan(COST_PER_APPEAL_MANUAL);
    expect(out.amount_cents).toBeLessThan(toCents(OLD_CAPACITY_CUTOFF));
    expect(out.would_have_been_worked_old).toBe(false);
  });

  it("is true exactly at the old capacity cutoff", () => {
    // The cutoff is inclusive: amount >= OLD_CAPACITY_CUTOFF.
    const out = triage({ ...base, amount: "5000.00" }, NOW);
    expect(out.amount_cents).toBe(toCents(OLD_CAPACITY_CUTOFF));
    expect(out.would_have_been_worked_old).toBe(true);
  });

  it("is computed even when the case is not appealable", () => {
    const out = triage({ ...base, eligible: false }, NOW);
    expect(out.decision).toBe("do_not_appeal");
    expect(out.would_have_been_worked_old).toBe(true);
  });
});
