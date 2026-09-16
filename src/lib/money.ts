/**
 * Money as integer cents.
 *
 * Denial amounts come out of Postgres as numeric strings ("18500.00"). Every
 * comparison against a threshold is done in cents so a case never lands on the
 * wrong side of a boundary through binary floating point. Dollars are only for
 * display.
 */

/** Parse a numeric string or dollar number into integer cents. Throws on junk. */
export function toCents(amount: string | number): number {
  // Number("") and Number("  ") are 0, which would turn a missing amount into
  // $0.00 and silently write off a case. Reject blank input explicitly.
  if (typeof amount === "string" && amount.trim() === "") {
    throw new Error("Not a valid money amount: empty string");
  }
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Not a valid money amount: ${JSON.stringify(amount)}`);
  return Math.round(value * 100);
}

/** Cents back to dollars, for display and for JSON that humans read. */
export function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Expected value in cents: amount x probability, rounded to the nearest cent.
 * The multiply is the only place a float enters, and rounding closes it.
 */
export function expectedValueCents(amountCents: number, probability: number): number {
  return Math.round(amountCents * probability);
}

export function formatUsd(cents: number): string {
  return `$${toDollars(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
