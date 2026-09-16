/**
 * Recompute the aggregate metrics of an existing EvalRun from its stored
 * per-case detail, without re-running the pipeline.
 *
 * Used when a metric definition is corrected: the underlying measurements did
 * not change, only the arithmetic over them, so paying for another 20 runs
 * would buy nothing. The per-case rows are re-graded with the current rules
 * and the run's metrics_json is rewritten in place.
 *
 * Usage: npx tsx scripts/eval/recompute.ts <evalRunId> [--write]
 * Without --write it prints the before and after and changes nothing.
 */

import "../seed/load-env";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/lib/db/client";
import { evalRuns } from "../../src/lib/db/schema";
import { formatMetric, METRIC_SPECS, evalMetricsSchema } from "../../src/lib/eval/metrics";
import { aggregate, isFalseWriteOff, type CaseGrade } from "./grade";

async function main(): Promise<void> {
  const id = process.argv[2];
  const write = process.argv.includes("--write");
  if (!id || id.startsWith("--")) {
    throw new Error("Usage: npx tsx scripts/eval/recompute.ts <evalRunId> [--write]");
  }

  const db = getDb();
  const [row] = await db.select().from(evalRuns).where(eq(evalRuns.id, id));
  if (!row) throw new Error(`No EvalRun ${id}`);

  const cases = row.perCaseJson as CaseGrade[];
  const before = evalMetricsSchema.parse(row.metricsJson);

  // Re-derive every per-case grade that a definition change can affect.
  const regraded: CaseGrade[] = cases.map((c) => ({
    ...c,
    grades: {
      ...c.grades,
      falseWriteOff:
        c.status === "completed" &&
        isFalseWriteOff({ winnable: c.expected.winnable, expectedRoute: c.expected.route }, c.actual.route),
    },
  }));

  const after = aggregate(regraded, {
    ruleTests: before.a.ruleTests,
    reviewerAgreement: before.e2e.reviewerAgreement,
  });
  evalMetricsSchema.parse(after);

  console.log(`EvalRun ${id}, ${cases.length} cases\n`);
  for (const spec of METRIC_SPECS) {
    const was = formatMetric(spec, before);
    const now = formatMetric(spec, after);
    const changed = was !== now;
    console.log(
      `  ${spec.group}  ${spec.label.padEnd(28)} ${was.padStart(8)} -> ${now.padStart(8)}` +
        (changed ? `   CHANGED (${spec.read(after).note})` : ""),
    );
  }

  if (!write) {
    console.log("\n  dry run, nothing written. Pass --write to apply.");
    return;
  }

  await db
    .update(evalRuns)
    .set({ metricsJson: after as never, perCaseJson: regraded as never })
    .where(eq(evalRuns.id, id));
  console.log(`\n  rewrote metrics_json and per_case_json on ${id}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/eval/recompute.ts")) {
  main()
    .catch((error) => {
      console.error("recompute failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
