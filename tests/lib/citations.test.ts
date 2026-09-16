import { describe, expect, it } from "vitest";
import { isClauseId, keyToLabel, labelToKey, lineKey, lineLabel, parseLineLabel } from "../../src/lib/citations";

describe("lineLabel and lineKey", () => {
  it("builds the label the model cites", () => {
    expect(lineLabel(47)).toBe("L47");
  });

  it("builds the database key with the account prefix", () => {
    expect(lineKey("ACC-DEMO-03", 47)).toBe("ACC-DEMO-03-L47");
  });
});

describe("parseLineLabel", () => {
  it("reads a well-formed label", () => {
    expect(parseLineLabel("L47")).toBe(47);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseLineLabel("  L7 ")).toBe(7);
  });

  it.each(["47", "LL7", "L", "L0", "L-3", "C12", "ACC-DEMO-03-L47", "L4 7", ""])(
    "rejects %s",
    (label) => {
      expect(parseLineLabel(label)).toBeNull();
    },
  );
});

describe("labelToKey", () => {
  it("maps a citation label to its database key", () => {
    expect(labelToKey("ACC-DEMO-03", "L47")).toBe("ACC-DEMO-03-L47");
  });

  it("returns null for a malformed label", () => {
    expect(labelToKey("ACC-DEMO-03", "line 47")).toBeNull();
  });

  it("maps a well-formed label for a line that may not exist", () => {
    // Whether the row exists is the citation validity gate's decision, not this
    // function's. It only refuses labels it cannot parse.
    expect(labelToKey("ACC-DEMO-03", "L99999")).toBe("ACC-DEMO-03-L99999");
  });
});

describe("keyToLabel", () => {
  it("recovers the label from a key", () => {
    expect(keyToLabel("ACC-DEMO-03-L47")).toBe("L47");
  });

  it("round-trips with labelToKey", () => {
    expect(keyToLabel(labelToKey("ACC-017", "L128")!)).toBe("L128");
  });

  it("returns null when there is no line suffix", () => {
    expect(keyToLabel("ACC-DEMO-03")).toBeNull();
  });
});

describe("isClauseId", () => {
  it.each(["C1", "C12", "C88"])("accepts %s", (id) => {
    expect(isClauseId(id)).toBe(true);
  });

  it.each(["L47", "CHF-01", "C", "12", "CS-pinnacle-sepsis"])("rejects %s", (id) => {
    expect(isClauseId(id)).toBe(false);
  });
});
