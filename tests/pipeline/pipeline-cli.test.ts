import { describe, expect, it } from "vitest";
import { parsePipelineArgs } from "../../scripts/pipeline";

describe("parsePipelineArgs", () => {
  it("reads the case ID", () => {
    expect(parsePipelineArgs(["--case", "DEMO-01"])).toEqual({
      denialId: "DEMO-01",
      letter: false,
      json: false,
      stream: false,
    });
  });

  it("reads the optional flags", () => {
    const args = parsePipelineArgs(["--case", "DEMO-01", "--letter", "--json", "--stream"]);
    expect([args.letter, args.json, args.stream]).toEqual([true, true, true]);
  });

  it("requires --case", () => {
    expect(() => parsePipelineArgs([])).toThrow(/Usage: npm run pipeline/);
  });

  it("rejects --case with no value", () => {
    expect(() => parsePipelineArgs(["--case", "--letter"])).toThrow(/Usage: npm run pipeline/);
  });

  it("rejects an unknown flag", () => {
    expect(() => parsePipelineArgs(["--case", "DEMO-01", "--verbose"])).toThrow(/Unknown argument\(s\): --verbose/);
  });
});
