import { eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { denials, pipelineRuns, reviewerFeedback } from "@/lib/db/schema";

/**
 * POST /api/demo/reset/[denialId]
 *
 * Deletes runs and feedback for one demo case so it can be run live again
 * during a rehearsal, the same operation as npm run demo:reset. Seed data is
 * untouched.
 *
 * Two guards, both deliberate:
 * - Only demo-split cases can be reset. Deleting runs for a dev or test case
 *   would silently change eval inputs.
 * - The endpoint is disabled unless NEXT_PUBLIC_DEMO_CONTROLS is on, so a
 *   public deployment cannot have its runs deleted by anyone who guesses the
 *   URL (PRD 6.2).
 */

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, ctx: RouteContext<"/api/demo/reset/[denialId]">) {
  if (process.env.NEXT_PUBLIC_DEMO_CONTROLS !== "true") {
    return Response.json({ error: "Demo controls are disabled." }, { status: 403 });
  }

  const { denialId } = await ctx.params;
  const db = getDb();

  const [denial] = await db
    .select({ id: denials.id, split: denials.split })
    .from(denials)
    .where(eq(denials.id, denialId));

  if (!denial) return Response.json({ error: `No denial ${denialId}.` }, { status: 404 });
  if (denial.split !== "demo") {
    return Response.json(
      { error: `${denialId} is in the ${denial.split} split. Only demo cases can be reset.` },
      { status: 400 },
    );
  }

  const runs = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.denialId, denialId));
  const runIds = runs.map((r) => r.id);

  let feedbackDeleted = 0;
  if (runIds.length > 0) {
    const removed = await db
      .delete(reviewerFeedback)
      .where(inArray(reviewerFeedback.runId, runIds))
      .returning({ id: reviewerFeedback.id });
    feedbackDeleted = removed.length;
    await db.delete(pipelineRuns).where(inArray(pipelineRuns.id, runIds));
  }

  return Response.json({ denialId, runsDeleted: runIds.length, feedbackDeleted });
}
