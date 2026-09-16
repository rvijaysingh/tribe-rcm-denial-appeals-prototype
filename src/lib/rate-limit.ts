/**
 * Rate cap for live pipeline runs (PRD 7 orchestrator, PRD 12).
 *
 * The demo runs on a public URL with a real API key behind it. Without a cap,
 * anyone who finds the link can spend the budget a dollar at a time. Twenty
 * runs an hour is far more than a demo needs and far less than a problem.
 *
 * The window is held in the server process, not the database, and that is
 * deliberate. A database count cannot tell a live run from a CLI run or an
 * eval run, so running `npm run eval` an hour before the interview would eat
 * the whole allowance and the demo would open on a 429. Counting in the
 * process that serves the route counts exactly the runs that route started.
 *
 * The cost is that a deploy or restart clears the window. For protecting a
 * demo budget from a public link that is an acceptable trade: a restart is not
 * something an anonymous visitor can trigger.
 */

/** Runs allowed per window. Overridable for a rehearsal that needs more. */
export const LIVE_RUN_LIMIT = Number(process.env.LIVE_RUN_LIMIT ?? 20);
export const LIVE_RUN_WINDOW_MS = 60 * 60 * 1000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Runs left in the window after this decision. */
  remaining: number;
  /** Seconds until the oldest run leaves the window. Zero when allowed. */
  retryAfterSeconds: number;
  /** The window to keep, with this run recorded when it was allowed. */
  window: number[];
}

/**
 * Decide whether one more run fits in the window, and return the window to
 * keep. Pure: the caller owns the state, which is what makes this testable
 * without faking a clock inside the module.
 */
export function consume(
  timestamps: readonly number[],
  now: number,
  limit: number = LIVE_RUN_LIMIT,
  windowMs: number = LIVE_RUN_WINDOW_MS,
): RateLimitDecision {
  const live = timestamps.filter((t) => now - t < windowMs).sort((a, b) => a - b);

  if (live.length < limit) {
    return {
      allowed: true,
      remaining: limit - live.length - 1,
      retryAfterSeconds: 0,
      window: [...live, now],
    };
  }

  // Full. The next slot frees when the oldest run ages out of the window.
  const oldest = live[0];
  const waitMs = Math.max(0, windowMs - (now - oldest));
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    window: live,
  };
}

/** Plain-language wait, for a message a person reads rather than a log. */
export function describeWait(seconds: number): string {
  if (seconds <= 90) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

export function rateLimitMessage(retryAfterSeconds: number, limit: number = LIVE_RUN_LIMIT): string {
  return (
    `This demo allows ${limit} live pipeline runs per hour so a public link cannot drain the API budget. ` +
    `The next slot opens in about ${describeWait(retryAfterSeconds)}. ` +
    `In the meantime, Show cached displays the last completed run for this case.`
  );
}
