import { describe, expect, it } from "vitest";
import { backoffMs } from "../../src/lib/embeddings";

describe("backoffMs", () => {
  it("waits out a per-minute bucket on a 429", () => {
    // The free tier allows 3 requests per minute, so the first retry has to
    // clear the window rather than land inside it.
    expect(backoffMs(1, 429, null)).toBe(20_000);
  });

  it("doubles the 429 wait up to a cap", () => {
    expect(backoffMs(2, 429, null)).toBe(40_000);
    expect(backoffMs(3, 429, null)).toBe(60_000);
    expect(backoffMs(9, 429, null)).toBe(60_000);
  });

  it("prefers the server's Retry-After", () => {
    expect(backoffMs(1, 429, "5")).toBe(5000);
  });

  it("caps an absurd Retry-After", () => {
    expect(backoffMs(1, 429, "9999")).toBe(90_000);
  });

  it("ignores a non-numeric Retry-After", () => {
    expect(backoffMs(1, 429, "Wed, 21 Oct 2026 07:28:00 GMT")).toBe(20_000);
    expect(backoffMs(1, 429, "")).toBe(20_000);
  });

  it("ignores a zero or negative Retry-After", () => {
    expect(backoffMs(1, 429, "0")).toBe(20_000);
    expect(backoffMs(1, 429, "-3")).toBe(20_000);
  });

  it("keeps short backoff for a server error", () => {
    expect(backoffMs(1, 503, null)).toBe(2000);
    expect(backoffMs(2, 503, null)).toBe(4000);
  });

  it("keeps short backoff for a network failure with no status", () => {
    expect(backoffMs(1, 0, null)).toBe(2000);
  });
});
