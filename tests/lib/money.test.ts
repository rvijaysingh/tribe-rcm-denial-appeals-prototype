import { describe, expect, it } from "vitest";
import { COST_PER_APPEAL_AI } from "../../src/lib/economics";
import { expectedValueCents, formatUsd, toCents, toDollars } from "../../src/lib/money";

describe("toCents", () => {
  it("parses a Postgres numeric string", () => {
    expect(toCents("18500.00")).toBe(1850000);
  });

  it("parses a dollar number", () => {
    expect(toCents(700)).toBe(70000);
  });

  it("rounds a fractional cent rather than truncating", () => {
    expect(toCents("0.005")).toBe(1);
  });

  it("handles a value that is not exact in binary floating point", () => {
    // 1.005 * 100 is 100.49999999999999 before rounding.
    expect(toCents(1.15)).toBe(115);
  });

  it.each(["", "abc", "$700"])("throws on %s", (value) => {
    expect(() => toCents(value)).toThrow(/not a valid money amount/i);
  });
});

describe("toDollars", () => {
  it("is the inverse of toCents", () => {
    expect(toDollars(toCents("9800.00"))).toBe(9800);
  });
});

describe("expectedValueCents", () => {
  it("computes EV in whole cents", () => {
    expect(expectedValueCents(toCents(700), 0.38)).toBe(26600);
  });

  it("avoids the float error that 70000 x 0.38 produces", () => {
    // The raw product is 26600.000000000004.
    expect(Number.isInteger(expectedValueCents(70000, 0.38))).toBe(true);
  });

  it("is exactly at the threshold for $500 at 0.55", () => {
    expect(expectedValueCents(toCents(500), 0.55)).toBe(toCents(COST_PER_APPEAL_AI));
  });

  it("is one cent above the threshold for $500.02 at 0.55", () => {
    expect(expectedValueCents(toCents(500.02), 0.55)).toBe(toCents(COST_PER_APPEAL_AI) + 1);
  });

  it("does not drift on a rate with more decimals", () => {
    expect(expectedValueCents(toCents(22000), 0.38)).toBe(836000);
  });
});

describe("formatUsd", () => {
  it("formats cents as dollars with separators", () => {
    expect(formatUsd(1850000)).toBe("$18,500.00");
  });

  it("formats a sub-dollar amount", () => {
    expect(formatUsd(7)).toBe("$0.07");
  });
});
