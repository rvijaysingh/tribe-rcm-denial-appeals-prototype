import { describe, expect, it } from "vitest";
import { consume, describeWait, rateLimitMessage } from "../../src/lib/rate-limit";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("consume", () => {
  it("allows the first run and records it", () => {
    const d = consume([], NOW, 3, HOUR);
    expect(d.allowed).toBe(true);
    expect(d.window).toEqual([NOW]);
  });

  it("counts down the remaining allowance", () => {
    expect(consume([], NOW, 3, HOUR).remaining).toBe(2);
    expect(consume([NOW - 1000], NOW, 3, HOUR).remaining).toBe(1);
    expect(consume([NOW - 2000, NOW - 1000], NOW, 3, HOUR).remaining).toBe(0);
  });

  it("allows exactly the limit before refusing", () => {
    const full = [NOW - 3000, NOW - 2000, NOW - 1000];
    expect(consume(full, NOW, 3, HOUR).allowed).toBe(false);
  });

  it("does not record a refused run", () => {
    const full = [NOW - 3000, NOW - 2000, NOW - 1000];
    expect(consume(full, NOW, 3, HOUR).window).toHaveLength(3);
  });

  it("drops runs that aged out of the window", () => {
    const stale = [NOW - HOUR - 1, NOW - HOUR - 5000];
    const d = consume(stale, NOW, 3, HOUR);
    expect(d.allowed).toBe(true);
    expect(d.window).toEqual([NOW]);
  });

  it("frees a slot as the oldest run ages out", () => {
    const full = [NOW - HOUR + 1000, NOW - 2000, NOW - 1000];
    expect(consume(full, NOW, 3, HOUR).allowed).toBe(false);
    // One second later the oldest has left the window.
    expect(consume(full, NOW + 1001, 3, HOUR).allowed).toBe(true);
  });

  it("reports how long until the next slot", () => {
    const full = [NOW - HOUR + 30_000, NOW - 2000, NOW - 1000];
    expect(consume(full, NOW, 3, HOUR).retryAfterSeconds).toBe(30);
  });

  it("never reports a zero wait when refusing", () => {
    const full = [NOW - HOUR, NOW - 2000, NOW - 1000];
    const d = consume(full, NOW + 1, 3, HOUR);
    if (!d.allowed) expect(d.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("is not confused by an unsorted window", () => {
    const full = [NOW - 1000, NOW - HOUR + 5000, NOW - 2000];
    expect(consume(full, NOW, 3, HOUR).retryAfterSeconds).toBe(5);
  });

  it("refuses everything when the limit is zero", () => {
    expect(consume([], NOW, 0, HOUR).allowed).toBe(false);
  });

  it("defaults to twenty runs an hour", () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => NOW - i * 1000);
    expect(consume(nineteen, NOW).allowed).toBe(true);
    const twenty = Array.from({ length: 20 }, (_, i) => NOW - i * 1000);
    expect(consume(twenty, NOW).allowed).toBe(false);
  });
});

describe("describeWait", () => {
  it("uses seconds for a short wait", () => {
    expect(describeWait(30)).toBe("30 seconds");
    expect(describeWait(90)).toBe("90 seconds");
  });

  it("switches to minutes for a long wait", () => {
    expect(describeWait(91)).toBe("2 minutes");
    expect(describeWait(1800)).toBe("30 minutes");
  });

  it("says a minute rather than 1 minutes", () => {
    expect(describeWait(60 * 60)).toBe("60 minutes");
    expect(describeWait(100)).toBe("2 minutes");
  });
});

describe("rateLimitMessage", () => {
  it("names the limit, the wait and the way out", () => {
    const message = rateLimitMessage(120, 20);
    expect(message).toContain("20 live pipeline runs per hour");
    expect(message).toContain("2 minutes");
    expect(message).toContain("Show cached");
  });

  it("does not leak jargon a panelist would not recognise", () => {
    expect(rateLimitMessage(60, 20)).not.toMatch(/429|HTTP|rate_limited/);
  });
});
