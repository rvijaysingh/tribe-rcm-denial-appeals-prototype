import { describe, expect, it } from "vitest";
import { parseResetArgs } from "../../scripts/demo-reset";

describe("parseResetArgs", () => {
  it("reads a denial ID", () => {
    expect(parseResetArgs(["--case", "DEMO-01"])).toEqual({ target: "DEMO-01" });
  });

  it("accepts all", () => {
    expect(parseResetArgs(["--case", "all"])).toEqual({ target: "all" });
  });

  it("requires --case", () => {
    expect(() => parseResetArgs([])).toThrow(/Usage: npm run demo:reset/);
  });

  it("rejects --case with no value", () => {
    expect(() => parseResetArgs(["--case"])).toThrow(/Usage: npm run demo:reset/);
  });

  it("rejects --case followed by another flag", () => {
    expect(() => parseResetArgs(["--case", "--force"])).toThrow(/Usage: npm run demo:reset/);
  });

  it("rejects an unknown argument", () => {
    expect(() => parseResetArgs(["--case", "DEMO-01", "--force"])).toThrow(/Unknown argument\(s\): --force/);
  });
});
