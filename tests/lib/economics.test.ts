import { describe, expect, it } from "vitest";
import {
  AI_BREAKEVEN,
  COST_PER_APPEAL_AI,
  COST_PER_APPEAL_MANUAL,
  CUTOFF_MULTIPLE,
  LOW_VALUE_WIN_RATE,
  MANUAL_BREAKEVEN,
  OLD_CAPACITY_CUTOFF,
} from "../../src/lib/economics";

/**
 * The value walk quotes these figures out loud, so they are asserted rather
 * than trusted: if a cost constant moves, a stale number must not survive in
 * the docs or on screen.
 */
describe("breakeven derivation", () => {
  it("derives the manual breakeven quoted as ~$1,800", () => {
    expect(MANUAL_BREAKEVEN).toBe(1800);
  });

  it("derives the AI breakeven quoted as ~$700", () => {
    expect(AI_BREAKEVEN).toBe(700);
  });

  it("rounds from the underlying arithmetic rather than hardcoding", () => {
    expect(COST_PER_APPEAL_MANUAL / LOW_VALUE_WIN_RATE).toBeCloseTo(1837.5, 5);
    expect(COST_PER_APPEAL_AI / LOW_VALUE_WIN_RATE).toBeCloseTo(687.5, 5);
  });

  it("puts the AI breakeven well below the manual one", () => {
    expect(AI_BREAKEVEN).toBeLessThan(MANUAL_BREAKEVEN);
  });

  it("keeps the capacity cutoff in the 2.5x to 3x band above manual breakeven", () => {
    // The reason a case can be economic and still never worked.
    expect(CUTOFF_MULTIPLE).toBeGreaterThanOrEqual(2.5);
    expect(CUTOFF_MULTIPLE).toBeLessThanOrEqual(3);
  });

  it("leaves the cutoff above both breakevens", () => {
    expect(OLD_CAPACITY_CUTOFF).toBeGreaterThan(MANUAL_BREAKEVEN);
    expect(OLD_CAPACITY_CUTOFF).toBeGreaterThan(AI_BREAKEVEN);
  });

  it("puts DEMO-02's $2,400 above manual breakeven but below the cutoff", () => {
    // The threshold story: economic to work, never worked.
    const demo02 = 2400;
    expect(demo02).toBeGreaterThan(MANUAL_BREAKEVEN);
    expect(demo02).toBeLessThan(OLD_CAPACITY_CUTOFF);
  });
});
