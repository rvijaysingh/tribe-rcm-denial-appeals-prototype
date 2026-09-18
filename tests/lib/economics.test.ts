import { describe, expect, it } from "vitest";
import {
  AI_BREAKEVEN,
  AI_BREAKEVEN_DISPLAY,
  AI_THRESHOLD_MULTIPLE,
  COST_PER_APPEAL_AI,
  COST_PER_APPEAL_MANUAL,
  LOW_VALUE_WIN_RATE,
  MANUAL_BREAKEVEN,
  MANUAL_BREAKEVEN_DISPLAY,
  MANUAL_THRESHOLD_MULTIPLE,
  OLD_CAPACITY_CUTOFF,
  WIN_RATE,
  WORK_THRESHOLD_AI,
} from "../../src/lib/economics";

/**
 * The value walk quotes these out loud, so they are asserted rather than
 * trusted: if a cost constant moves, a stale number must not survive in the
 * docs or on screen.
 */
describe("breakeven, which is pure economics", () => {
  it("is cost per appeal over the win rate on that tier", () => {
    expect(MANUAL_BREAKEVEN).toBeCloseTo(1837.5, 5);
    expect(AI_BREAKEVEN).toBe(750);
  });

  it("derives rather than hardcodes", () => {
    expect(MANUAL_BREAKEVEN).toBe(COST_PER_APPEAL_MANUAL / LOW_VALUE_WIN_RATE);
    expect(AI_BREAKEVEN).toBe(COST_PER_APPEAL_AI / LOW_VALUE_WIN_RATE);
  });

  it("keeps the rounded copy honest about the arithmetic", () => {
    // ~$1,800 stands in for $1,837.50 and ~$750 is exact.
    expect(Math.abs(MANUAL_BREAKEVEN_DISPLAY - MANUAL_BREAKEVEN) / MANUAL_BREAKEVEN).toBeLessThan(0.03);
    expect(AI_BREAKEVEN_DISPLAY).toBe(AI_BREAKEVEN);
  });

  it("falls when the cost of an appeal falls", () => {
    expect(AI_BREAKEVEN).toBeLessThan(MANUAL_BREAKEVEN);
  });
});

describe("work threshold, which is the operating rule", () => {
  it("sits 2.5x to 3x above breakeven today", () => {
    expect(MANUAL_THRESHOLD_MULTIPLE).toBeGreaterThanOrEqual(2.5);
    expect(MANUAL_THRESHOLD_MULTIPLE).toBeLessThanOrEqual(3);
  });

  it("falls to roughly 1.5x with the pipeline", () => {
    expect(AI_THRESHOLD_MULTIPLE).toBeGreaterThanOrEqual(1.4);
    expect(AI_THRESHOLD_MULTIPLE).toBeLessThanOrEqual(1.7);
  });

  it("falls further than breakeven does, which is the shape of the win", () => {
    const breakevenDrop = 1 - AI_BREAKEVEN / MANUAL_BREAKEVEN;
    const thresholdDrop = 1 - WORK_THRESHOLD_AI / OLD_CAPACITY_CUTOFF;
    expect(thresholdDrop).toBeGreaterThan(breakevenDrop);
  });

  it("stays above its own breakeven on both sides", () => {
    expect(OLD_CAPACITY_CUTOFF).toBeGreaterThan(MANUAL_BREAKEVEN);
    expect(WORK_THRESHOLD_AI).toBeGreaterThan(AI_BREAKEVEN);
  });
});

describe("the demo cases still land where the story needs them", () => {
  it("routes DNA-02 do-not-appeal at the raised AI cost", () => {
    // $700 at the Northgate medical-necessity floor.
    const ev = 700 * WIN_RATE.northgate.medical_necessity;
    expect(ev).toBeCloseTo(266, 5);
    expect(ev).toBeLessThan(COST_PER_APPEAL_AI);
  });

  it("still appeals DEMO-02", () => {
    const ev = 2400 * WIN_RATE.cascade.level_of_care;
    expect(ev).toBeCloseTo(1152, 5);
    expect(ev).toBeGreaterThan(COST_PER_APPEAL_AI);
  });

  it("puts DEMO-02 above today's breakeven and below today's work threshold", () => {
    // Economic to file, and still never filed. The threshold story.
    expect(2400).toBeGreaterThan(MANUAL_BREAKEVEN);
    expect(2400).toBeLessThan(OLD_CAPACITY_CUTOFF);
  });

  it("puts DEMO-02 above the pipeline's work threshold, so it gets filed", () => {
    expect(2400).toBeGreaterThan(WORK_THRESHOLD_AI);
  });
});
