/**
 * npm run eval
 *
 * Runs the pipeline over a labeled split, grades every case against
 * GroundTruth, and writes an EvalRun with the PRD 9.2 metric set plus per-case
 * detail. Demo cases are never touched (PRD 9.1).
 *
 * Flags:
 *   --split=test|dev   which labeled split to run (default test)
 *   --reference        mark this run as the reference run (PRD 9.3)
 *   --concurrency=N    cases in flight at once, 1 to 8 (default 4)
 *   --skip-tests       do not run the vitest suite for the rule-test metric
 *   --dry-run          grade and print without writing an EvalRun row
 *   --only=ID,ID       run just these denial ids
 */

import "../seed/load-env";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/lib/db/client";
import { loadGroundTruthForSplit, nextEvalRunId, type GroundTruthCase } from "../../src/lib/db/queries";
import { evalRuns } from "../../src/lib/db/schema";
import { formatMetric, METRIC_SPECS, evalMetricsSchema } from "../../src/lib/eval/metrics";
import { MODELS, modelSet } from "../../src/lib/models";
import { PROMPT_VERSION, runPipeline } from "../../src/lib/pipeline/orchestrator";
import { mapPool } from "../seed/concurrency";
import { parseEvalArgs } from "./args";
import { aggregate, failedCase, gradeCase, type CaseGrade } from "./grade";
import { runRuleTests } from "./rule-tests";

async function gradeSplit(cases: GroundTruthCase[], concurrency: number): Promise<CaseGrade[]> {
  let done = 0;
  const settled = await mapPool(cases, concurrency, async (truth) => {
    try {
      const result = await runPipeline(truth.denialId);
      const grade = gradeCase(truth, result);
      done += 1;
      console.log(
        `  [${String(done).padStart(2)}/${cases.length}] ${truth.denialId} ` +
          `${grade.actual.route} (expected ${grade.expected.route})` +
          `${grade.grades.routeCorrect ? "" : "  MISS"}`,
      );
      return grade;
    } catch (error) {
      done += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [${String(done).padStart(2)}/${cases.length}] ${truth.denialId} FAILED: ${message}`);
      return failedCase(truth, message);
    }
  });

  // mapPool only rejects if the callback itself throws, which it does not:
  // failures are already converted to a graded failure above.
  return settled.map((outcome, i) =>
    outcome.status === "fulfilled" ? outcome.value : failedCase(cases[i], String(outcome.reason)),
  );
}

async function main(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2));

  const all = await loadGroundTruthForSplit(args.split);
  const cases = args.only.size > 0 ? all.filter((c) => args.only.has(c.denialId)) : all;
  if (cases.length === 0) {
    throw new Error(
      args.only.size > 0
        ? `None of --only matched a labeled case in the ${args.split} split`
        : `No labeled cases in the ${args.split} split. Run npm run db:seed first.`,
    );
  }

  console.log(`Eval on ${cases.length} ${args.split} case(s)`);
  console.log(`  models: classify=${MODELS.classify} draft=${MODELS.draft} verify=${MODELS.verify}`);
  console.log(`  prompts: ${PROMPT_VERSION}\n`);

  if (args.reference && MODELS.draft !== "claude-opus-5") {
    console.warn(
      `  warning: PRD 9.3 reserves the reference run for Opus, but the draft model is ${MODELS.draft}.\n` +
        "  This run will be badged as the prototype's quotable result anyway.\n",
    );
  }

  const started = Date.now();
  const grades = await gradeSplit(cases, args.concurrency);

  let ruleTests = null;
  if (args.withTests) {
    console.log("\n  running the unit suite for the stage A rule-test metric");
    ruleTests = await runRuleTests();
  }

  const metrics = aggregate(grades, { ruleTests, reviewerAgreement: null });

  // Fail loudly if the harness produced something the dashboard cannot read,
  // rather than writing a row that renders as "unreadable" later.
  const parsed = evalMetricsSchema.safeParse(metrics);
  if (!parsed.success) {
    throw new Error(`Aggregated metrics do not match the contract: ${parsed.error.message}`);
  }

  console.log(`\n  ${cases.length} case(s) in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  for (const spec of METRIC_SPECS) {
    const { note } = spec.read(metrics);
    console.log(
      `  ${spec.group}  ${spec.label.padEnd(28)} ${formatMetric(spec, metrics).padStart(8)}   ${note}`,
    );
  }

  if (args.dryRun) {
    console.log("\n  --dry-run: no EvalRun written");
    return;
  }

  const db = getDb();
  const id = await nextEvalRunId();

  if (args.reference) {
    // PRD 9.3 describes one reference run, so marking a new one retires the
    // old. Anything else leaves two runs claiming to be the quotable result.
    const cleared = await db
      .update(evalRuns)
      .set({ reference: false })
      .where(eq(evalRuns.reference, true))
      .returning({ id: evalRuns.id });
    for (const row of cleared) console.log(`  cleared the reference flag on ${row.id}`);
  }

  await db.insert(evalRuns).values({
    id,
    split: args.split,
    caseCount: cases.length,
    promptVersion: PROMPT_VERSION,
    modelSet: modelSet(),
    metricsJson: metrics as never,
    perCaseJson: grades as never,
    reference: args.reference,
  });

  console.log(`\n  wrote EvalRun ${id}${args.reference ? " (reference)" : ""}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/eval/index.ts")) {
  main()
    .catch((error) => {
      console.error("eval failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
