import { describe, expect, it } from "vitest";
import { lineDiff } from "../../src/lib/diff";

describe("lineDiff", () => {
  it("reports no changes for identical text", () => {
    const result = lineDiff("a\nb\nc", "a\nb\nc");
    expect(result.unchanged).toBe(true);
    expect(result.changes).toEqual([]);
  });

  it("reports an edit as one removal and one addition", () => {
    const result = lineDiff("a\nb\nc", "a\nB\nc");
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(1);
    expect(result.changes.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
  });

  it("reports an inserted line as an addition only", () => {
    const result = lineDiff("a\nc", "a\nb\nc");
    expect(result).toMatchObject({ addedCount: 1, removedCount: 0, unchanged: false });
    expect(result.changes[0]).toMatchObject({ kind: "added", text: "b" });
  });

  it("reports a deleted line as a removal only", () => {
    const result = lineDiff("a\nb\nc", "a\nc");
    expect(result).toMatchObject({ addedCount: 0, removedCount: 1 });
    expect(result.changes[0]).toMatchObject({ kind: "removed", text: "b" });
  });

  it("keeps untouched lines out of the change list", () => {
    const before = "one\ntwo\nthree\nfour";
    const result = lineDiff(before, "one\ntwo\nCHANGED\nfour");
    expect(result.changes.every((c) => c.text === "three" || c.text === "CHANGED")).toBe(true);
  });

  it("handles a reviewer replacing the whole letter", () => {
    const result = lineDiff("a\nb", "x\ny\nz");
    expect(result.removedCount).toBe(2);
    expect(result.addedCount).toBe(3);
  });

  it("handles an empty original", () => {
    expect(lineDiff("", "new line").addedCount).toBe(1);
  });

  it("records the line number the change sits at", () => {
    const result = lineDiff("a\nb\nc", "a\nb\nc\nd");
    expect(result.changes[0]).toMatchObject({ kind: "added", line: 4, text: "d" });
  });
});
