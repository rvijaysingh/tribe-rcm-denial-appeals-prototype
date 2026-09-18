import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOX,
  domainFor,
  labelIndices,
  linePath,
  makeScale,
  percentDelta,
  ticks,
} from "../../src/lib/dashboard/chart";
import {
  recoveryRateHistory,
  rnTouchTimeHistory,
  seriesMean,
  weekdaysEnding,
} from "../../src/lib/dashboard/series";

const WEDNESDAY = new Date("2026-09-16T12:00:00Z");

describe("weekdaysEnding", () => {
  it("returns only weekdays", () => {
    for (const d of weekdaysEnding(WEDNESDAY, 4)) {
      expect(d.getUTCDay()).not.toBe(0);
      expect(d.getUTCDay()).not.toBe(6);
    }
  });

  it("returns 20 days for a 4 week window", () => {
    expect(weekdaysEnding(WEDNESDAY, 4)).toHaveLength(20);
  });

  it("ends on today when today is a weekday", () => {
    const days = weekdaysEnding(WEDNESDAY, 4);
    expect(days[days.length - 1].toISOString().slice(0, 10)).toBe("2026-09-16");
  });

  it("ends on the previous weekday when today is a Sunday", () => {
    const sunday = new Date("2026-09-20T12:00:00Z");
    const days = weekdaysEnding(sunday, 4);
    expect(days[days.length - 1].toISOString().slice(0, 10)).toBe("2026-09-18");
  });

  it("is ordered oldest to newest", () => {
    const days = weekdaysEnding(WEDNESDAY, 4);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].getTime()).toBeGreaterThan(days[i - 1].getTime());
    }
  });
});

describe("rnTouchTimeHistory", () => {
  it("stays inside the stated 180 to 245 band", () => {
    for (const p of rnTouchTimeHistory(WEDNESDAY)) {
      expect(p.value).toBeGreaterThanOrEqual(180);
      expect(p.value).toBeLessThanOrEqual(245);
    }
  });

  it("averages near 210, which is what the dashed line claims", () => {
    const mean = seriesMean(rnTouchTimeHistory(WEDNESDAY));
    expect(mean).toBeGreaterThan(195);
    expect(mean).toBeLessThan(225);
  });

  it("is stable for the same day, so the chart does not move on refresh", () => {
    const a = rnTouchTimeHistory(new Date("2026-09-16T08:00:00Z"));
    const b = rnTouchTimeHistory(new Date("2026-09-16T23:00:00Z"));
    expect(a.map((p) => p.value)).toEqual(b.map((p) => p.value));
  });

  it("differs from one day to the next, so it is not a flat line", () => {
    const a = rnTouchTimeHistory(new Date("2026-09-16T12:00:00Z")).map((p) => p.value);
    const b = rnTouchTimeHistory(new Date("2026-09-17T12:00:00Z")).map((p) => p.value);
    expect(a).not.toEqual(b);
  });
});

describe("recoveryRateHistory", () => {
  it("returns twelve months ending this month", () => {
    const points = recoveryRateHistory(WEDNESDAY);
    expect(points).toHaveLength(12);
    expect(points[11].iso.slice(0, 7)).toBe("2026-09");
    expect(points[0].iso.slice(0, 7)).toBe("2025-10");
  });

  it("stays inside the stated 40 to 43 percent band", () => {
    for (const p of recoveryRateHistory(WEDNESDAY)) {
      expect(p.value).toBeGreaterThanOrEqual(40);
      expect(p.value).toBeLessThanOrEqual(43);
    }
  });

  it("stays well below the 55 percent target, which is the point of the chart", () => {
    for (const p of recoveryRateHistory(WEDNESDAY)) expect(p.value).toBeLessThan(55);
  });

  it("is stable within a day", () => {
    const a = recoveryRateHistory(new Date("2026-09-16T01:00:00Z")).map((p) => p.value);
    const b = recoveryRateHistory(new Date("2026-09-16T20:00:00Z")).map((p) => p.value);
    expect(a).toEqual(b);
  });
});

describe("makeScale", () => {
  const scale = makeScale(5, 0, 100);

  it("puts the first point on the left edge of the plot", () => {
    expect(scale.x(0)).toBe(DEFAULT_BOX.padLeft);
  });

  it("puts the last point on the right edge", () => {
    expect(scale.x(4)).toBeCloseTo(DEFAULT_BOX.width - DEFAULT_BOX.padRight, 5);
  });

  it("maps the domain maximum to the top", () => {
    expect(scale.y(100)).toBeCloseTo(DEFAULT_BOX.padTop, 5);
  });

  it("maps the domain minimum to the bottom", () => {
    expect(scale.y(0)).toBeCloseTo(DEFAULT_BOX.height - DEFAULT_BOX.padBottom, 5);
  });

  it("clamps a value outside the domain rather than drawing off canvas", () => {
    expect(scale.y(500)).toBeCloseTo(DEFAULT_BOX.padTop, 5);
    expect(scale.y(-500)).toBeCloseTo(DEFAULT_BOX.height - DEFAULT_BOX.padBottom, 5);
  });

  it("centres a single point instead of dividing by zero", () => {
    const one = makeScale(1, 0, 10);
    expect(Number.isFinite(one.x(0))).toBe(true);
  });

  it("widens a flat domain instead of dividing by zero", () => {
    const flat = makeScale(3, 7, 7);
    expect(Number.isFinite(flat.y(7))).toBe(true);
    expect(flat.max).toBeGreaterThan(flat.min);
  });
});

describe("domainFor", () => {
  it("covers the reference lines as well as the data", () => {
    const d = domainFor([40, 43], [55, 60]);
    expect(d.min).toBeLessThan(40);
    expect(d.max).toBeGreaterThan(60);
  });

  it("leaves headroom so the line never touches the frame", () => {
    const d = domainFor([10, 20]);
    expect(d.min).toBeLessThan(10);
    expect(d.max).toBeGreaterThan(20);
  });

  it("handles an empty series", () => {
    expect(domainFor([])).toEqual({ min: 0, max: 1 });
  });
});

describe("linePath", () => {
  it("starts with a move and continues with lines", () => {
    const path = linePath([1, 2, 3], makeScale(3, 0, 3));
    expect(path.startsWith("M")).toBe(true);
    expect(path.match(/L/g)).toHaveLength(2);
  });

  it("is empty for no data", () => {
    expect(linePath([], makeScale(0, 0, 1))).toBe("");
  });
});

describe("ticks", () => {
  it("spans the domain inclusively", () => {
    const scale = makeScale(5, 0, 100);
    const t = ticks(scale, 4);
    expect(t).toHaveLength(5);
    expect(t[0]).toBeCloseTo(scale.min, 5);
    expect(t[4]).toBeCloseTo(scale.max, 5);
  });
});

describe("labelIndices", () => {
  it("keeps every label when they fit", () => {
    expect(labelIndices(5, 8)).toEqual([0, 1, 2, 3, 4]);
  });

  it("thins them out when they do not, always keeping the ends", () => {
    const idx = labelIndices(20, 6);
    expect(idx.length).toBeLessThanOrEqual(8);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(19);
  });
});

describe("percentDelta", () => {
  it("reports the drop that makes the demo's point", () => {
    expect(percentDelta(2.4, 210)).toBeCloseTo(-98.86, 1);
  });

  it("returns null rather than dividing by zero", () => {
    expect(percentDelta(5, 0)).toBeNull();
  });
});
