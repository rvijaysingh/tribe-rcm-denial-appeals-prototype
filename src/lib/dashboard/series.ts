/**
 * Mock history for the Claim Denial Dashboard charts (PRD 6.4).
 *
 * Both series are generated relative to the current date, so the axes never go
 * stale the way a hardcoded date range does. The noise is seeded from the date
 * itself, so a given day always draws the same chart: a demo that redraws
 * differently on each refresh looks broken, and a chart that drifts while the
 * presenter talks is worse.
 *
 * Everything here is mock and labeled as such on screen. The only real number
 * on either chart is today's RN touch time, which comes from the database.
 */

export interface SeriesPoint {
  /** Axis label, short enough to render without rotation. */
  label: string;
  /** ISO date, for keys and tooltips. */
  iso: string;
  value: number;
}

/** Mulberry32. Small, fast, and stable across platforms. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A date seeds its own noise, so the series is stable for the whole day. */
function seedFor(date: Date, salt: number): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate() + salt;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The weekdays of the last `weeks` weeks, ending on `today` (inclusive when
 * today is a weekday). Weekends are skipped: a denials shop does not work them,
 * and a flat weekend in the series reads as an outage rather than a Saturday.
 */
export function weekdaysEnding(today: Date, weeks: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // Walk back far enough to cover the window, then keep the weekdays.
  for (let i = 0; i < weeks * 7; i++) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.reverse();
}

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Manual RN touch time, noisy around 210 minutes within 180 to 245. */
export function rnTouchTimeHistory(today: Date, weeks = 4): SeriesPoint[] {
  const days = weekdaysEnding(today, weeks);
  return days.map((d, i) => {
    const next = rng(seedFor(d, i * 7919));
    // Two draws averaged, so the walk is gentler than uniform noise.
    const unit = (next() + next()) / 2;
    const value = Math.round(180 + unit * (245 - 180));
    return { label: `${WEEKDAY_LABEL[d.getUTCDay()]} ${d.getUTCDate()}`, iso: isoDate(d), value };
  });
}

/** Mean of a series, for the dashed 4-week average line. */
export function seriesMean(points: readonly SeriesPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.value, 0) / points.length;
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Trailing twelve months of denied-dollar recovery rate, drifting between 40%
 * and 43%. Returned as percentages, not fractions, because the axis is labeled
 * in percent and converting twice invites an off-by-100.
 */
export function recoveryRateHistory(today: Date, months = 12): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  let level = 41;
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const next = rng(seedFor(d, 104729));
    // A random walk that is pulled back toward the middle of the band, so it
    // wanders without ever leaving 40 to 43.
    level += (next() - 0.5) * 0.9 + (41.5 - level) * 0.25;
    const value = Math.min(43, Math.max(40, Math.round(level * 10) / 10));
    points.push({
      label: `${MONTH_LABEL[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
      iso: isoDate(d),
      value,
    });
  }
  return points;
}
