/**
 * Chart geometry for the dashboard's two line charts.
 *
 * Hand-rolled rather than pulling in a charting library: two line charts with a
 * couple of reference lines do not justify the dependency, and keeping the
 * maths here as pure functions means the scales are unit-tested instead of
 * eyeballed in a browser.
 *
 * All functions work in a viewBox coordinate space. The caller renders SVG.
 */

export interface ChartBox {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export const DEFAULT_BOX: ChartBox = {
  width: 640,
  height: 260,
  padLeft: 46,
  padRight: 14,
  padTop: 16,
  padBottom: 30,
};

export interface Scale {
  x: (index: number) => number;
  y: (value: number) => number;
  plotWidth: number;
  plotHeight: number;
  min: number;
  max: number;
}

/**
 * Linear scales for `count` evenly spaced points over a [min, max] domain.
 *
 * The domain is padded so the line never touches the frame, and a degenerate
 * domain (every value identical) is widened rather than dividing by zero.
 */
export function makeScale(count: number, min: number, max: number, box: ChartBox = DEFAULT_BOX): Scale {
  const plotWidth = box.width - box.padLeft - box.padRight;
  const plotHeight = box.height - box.padTop - box.padBottom;

  let lo = min;
  let hi = max;
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;

  return {
    plotWidth,
    plotHeight,
    min: lo,
    max: hi,
    x: (index) => {
      if (count <= 1) return box.padLeft + plotWidth / 2;
      return box.padLeft + (index / (count - 1)) * plotWidth;
    },
    y: (value) => {
      const clamped = Math.min(hi, Math.max(lo, value));
      return box.padTop + plotHeight - ((clamped - lo) / span) * plotHeight;
    },
  };
}

/** Domain covering every value plus any reference lines, with headroom. */
export function domainFor(values: readonly number[], extra: readonly number[] = []): { min: number; max: number } {
  const all = [...values, ...extra];
  if (all.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1;
  return { min: min - pad, max: max + pad };
}

/** An SVG polyline path through the values. */
export function linePath(values: readonly number[], scale: Scale): string {
  if (values.length === 0) return "";
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${scale.x(i).toFixed(2)},${scale.y(v).toFixed(2)}`).join(" ");
}

/**
 * Evenly spaced axis ticks across the domain. Returns the raw values; the
 * caller formats them, since minutes and percentages read differently.
 */
export function ticks(scale: Scale, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(scale.min + ((scale.max - scale.min) * i) / count);
  return out;
}

/**
 * Which x-axis labels to draw, so a 20-point axis does not overlap itself.
 * Always keeps the first and last.
 */
export function labelIndices(count: number, maxLabels: number): number[] {
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / maxLabels);
  const keep = new Set<number>();
  for (let i = 0; i < count; i += step) keep.add(i);
  keep.add(count - 1);
  return [...keep].sort((a, b) => a - b);
}

/** Percentage change from a baseline, for the "-99%" callout. */
export function percentDelta(value: number, baseline: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((value - baseline) / baseline) * 100;
}
