/**
 * Command-line flags for npm run eval. Kept apart from index.ts so tests can
 * import it without loading the database client.
 */

import type { Split } from "../../src/lib/domain";

export interface EvalArgs {
  split: Split;
  /** Mark the created run as the reference run (PRD 9.3). */
  reference: boolean;
  concurrency: number;
  /** Run the vitest suite to fill the stage A rule-test metric. */
  withTests: boolean;
  /** Grade and print without writing an EvalRun row. */
  dryRun: boolean;
  /** Run only these denial ids, for a cheap smoke test of the harness. */
  only: ReadonlySet<string>;
}

export function parseEvalArgs(argv: string[]): EvalArgs {
  const valueOf = (flag: string): string | undefined =>
    argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);

  const known = ["--split", "--reference", "--concurrency", "--skip-tests", "--dry-run", "--only"];
  const unknown = argv.filter((a) => !known.includes(a.split("=")[0]));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);

  const splitRaw = valueOf("--split") ?? "test";
  // Demo cases are never evaluated (PRD 9.1). Rejecting the flag outright is
  // clearer than silently filtering them out of the set.
  if (splitRaw !== "test" && splitRaw !== "dev") {
    throw new Error(`--split must be test or dev, not ${splitRaw}. Demo cases are never evaluated.`);
  }

  const concurrency = Number(valueOf("--concurrency") ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8");
  }

  return {
    split: splitRaw,
    reference: argv.includes("--reference"),
    concurrency,
    withTests: !argv.includes("--skip-tests"),
    dryRun: argv.includes("--dry-run"),
    only: new Set((valueOf("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
  };
}
