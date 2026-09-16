import { describe, expect, it } from "vitest";
import { parseEvalArgs } from "../../scripts/eval/args";

describe("parseEvalArgs", () => {
  it("defaults to the test split with tests on", () => {
    expect(parseEvalArgs([])).toMatchObject({
      split: "test",
      reference: false,
      concurrency: 4,
      withTests: true,
      dryRun: false,
    });
  });

  it("accepts the dev split", () => {
    expect(parseEvalArgs(["--split=dev"]).split).toBe("dev");
  });

  it("refuses to evaluate demo cases", () => {
    expect(() => parseEvalArgs(["--split=demo"])).toThrow(/never evaluated/);
  });

  it("refuses an unknown split", () => {
    expect(() => parseEvalArgs(["--split=holdout"])).toThrow(/must be test or dev/);
  });

  it("reads the reference flag", () => {
    expect(parseEvalArgs(["--reference"]).reference).toBe(true);
  });

  it("turns tests off with --skip-tests", () => {
    expect(parseEvalArgs(["--skip-tests"]).withTests).toBe(false);
  });

  it("parses a concurrency in range", () => {
    expect(parseEvalArgs(["--concurrency=8"]).concurrency).toBe(8);
  });

  it("rejects a concurrency out of range", () => {
    expect(() => parseEvalArgs(["--concurrency=0"])).toThrow(/1 to 8/);
    expect(() => parseEvalArgs(["--concurrency=9"])).toThrow(/1 to 8/);
  });

  it("rejects a non-integer concurrency", () => {
    expect(() => parseEvalArgs(["--concurrency=two"])).toThrow(/1 to 8/);
  });

  it("parses an --only list", () => {
    expect([...parseEvalArgs(["--only=A-1, A-2"]).only]).toEqual(["A-1", "A-2"]);
  });

  it("treats an empty --only as no filter", () => {
    expect(parseEvalArgs(["--only="]).only.size).toBe(0);
  });

  it("rejects unknown flags rather than ignoring them", () => {
    expect(() => parseEvalArgs(["--refrence"])).toThrow(/Unknown argument/);
  });
});
