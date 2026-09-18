/**
 * npm run demo:reset -- --case <id>
 *
 * Deletes pipeline runs and reviewer feedback for a demo case so it can be run
 * live again during a rehearsal (PRD 4, under 2 seconds). Seed data is not
 * touched: the denial, chart, letter and ground truth all stay.
 *
 * Only cases in the demo split can be reset. Deleting runs for a dev or test
 * case would silently change eval inputs, so that is refused.
 *
 * Use --case all to reset every demo case.
 */

import "./seed/load-env";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db/client";
import { deleteTodaysFeedback } from "../src/lib/db/queries";
import { denials, pipelineRuns, reviewerFeedback } from "../src/lib/db/schema";

export interface ResetArgs {
  /** A denial ID, or "all" for every demo case. */
  target: string;
}

export function parseResetArgs(argv: string[]): ResetArgs {
  const index = argv.indexOf("--case");
  const target = index > -1 ? argv[index + 1] : undefined;
  if (!target || target.startsWith("--")) {
    throw new Error("Usage: npm run demo:reset -- --case <DENIAL_ID|all>");
  }
  const extra = argv.filter((a, i) => i !== index && i !== index + 1);
  if (extra.length > 0) throw new Error(`Unknown argument(s): ${extra.join(" ")}`);
  return { target };
}

export interface ResetResult {
  cases: string[];
  runsDeleted: number;
  feedbackDeleted: number;
}

async function main(): Promise<void> {
  const { target } = parseResetArgs(process.argv.slice(2));
  const db = getDb();
  const started = Date.now();

  const demoCases = await db
    .select({ id: denials.id })
    .from(denials)
    .where(eq(denials.split, "demo"));
  const demoIds = demoCases.map((d) => d.id);

  let targets: string[];
  if (target === "all") {
    targets = demoIds;
  } else if (demoIds.includes(target)) {
    targets = [target];
  } else {
    const [exists] = await db.select({ split: denials.split }).from(denials).where(eq(denials.id, target));
    throw new Error(
      exists
        ? `${target} is in the ${exists.split} split. Only demo cases can be reset, because ` +
          `deleting runs for an eval case would change its inputs.`
        : `No denial ${target}. Demo cases are: ${demoIds.join(", ")}`,
    );
  }

  const runs = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(inArray(pipelineRuns.denialId, targets));
  const runIds = runs.map((r) => r.id);

  let feedbackDeleted = 0;
  if (runIds.length > 0) {
    // Feedback cascades with the run, but delete it explicitly so the count is reportable.
    const removedFeedback = await db
      .delete(reviewerFeedback)
      .where(inArray(reviewerFeedback.runId, runIds))
      .returning({ id: reviewerFeedback.id });
    feedbackDeleted = removedFeedback.length;
    await db.delete(pipelineRuns).where(inArray(pipelineRuns.id, runIds));
  }

  // Also clear the rest of today's feedback, across every case. The RN
  // touch-time chart plots today's approvals, so a reset that left another
  // case's approval behind would leave a point on a chart that is meant to
  // read "no approvals yet today".
  const todaysFeedbackDeleted = await deleteTodaysFeedback();

  console.log(
    `Reset ${targets.length} case(s): ${targets.join(", ")}` +
      `
  ${runIds.length} pipeline run(s) and ${feedbackDeleted} feedback row(s) deleted` +
      `
  ${todaysFeedbackDeleted} feedback row(s) from today cleared across all cases` +
      `
  in ${Date.now() - started}ms`,
  );
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/demo-reset.ts")) {
  main()
    .catch((error) => {
      console.error("demo:reset failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
