import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { pipelineRuns, reviewerFeedback, stageOutputs } from "@/lib/db/schema";
import { lineDiff } from "@/lib/diff";
import { REVIEW_ACTIONS, type ReviewAction } from "@/lib/domain";

/**
 * POST /api/feedback/[runId]
 *
 * Records what the reviewer did with a draft: approve, edit or escalate
 * (PRD 6.3). Reviewer minutes are measured by the client from panel-open to
 * action and stamped here.
 *
 * On an edit the diff is computed server-side against the letter the run
 * actually produced, not against whatever the client claims the original was.
 */

export const dynamic = "force-dynamic";

interface FeedbackBody {
  action: ReviewAction;
  reviewerMinutes: number;
  editedText?: string;
  reason?: string;
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/feedback/[runId]">) {
  const { runId } = await ctx.params;
  const body = (await request.json()) as FeedbackBody;

  if (!REVIEW_ACTIONS.includes(body.action)) {
    return Response.json({ error: `Unknown action ${body.action}.` }, { status: 400 });
  }
  if (!Number.isFinite(body.reviewerMinutes) || body.reviewerMinutes < 0) {
    return Response.json({ error: "reviewerMinutes must be a non-negative number." }, { status: 400 });
  }
  if (body.action === "escalate" && !body.reason?.trim()) {
    return Response.json({ error: "Escalation requires a reason." }, { status: 400 });
  }
  if (body.action === "edit" && typeof body.editedText !== "string") {
    return Response.json({ error: "An edit requires the edited text." }, { status: 400 });
  }

  const db = getDb();
  const [run] = await db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  if (!run) return Response.json({ error: `No run ${runId}.` }, { status: 404 });

  let diffJson: unknown = null;
  if (body.action === "edit") {
    const [draftStage] = await db
      .select({ output: stageOutputs.outputJson })
      .from(stageOutputs)
      .where(and(eq(stageOutputs.runId, runId), eq(stageOutputs.stage, "d_draft")));
    const original = (draftStage?.output as { letterText?: string } | undefined)?.letterText ?? "";
    diffJson = { ...lineDiff(original, body.editedText ?? ""), originalLength: original.length };
  }

  const id = `FB-${randomUUID().slice(0, 8).toUpperCase()}`;
  await db.insert(reviewerFeedback).values({
    id,
    runId,
    action: body.action,
    editedText: body.action === "edit" ? (body.editedText ?? null) : null,
    diffJson: diffJson as never,
    reason: body.reason?.trim() || null,
    reviewerMinutes: body.reviewerMinutes,
  });

  return Response.json({ id, action: body.action, diff: diffJson });
}
