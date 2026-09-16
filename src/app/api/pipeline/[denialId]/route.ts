import type { NextRequest } from "next/server";
import { runPipeline, type StageEvent } from "@/lib/pipeline/orchestrator";

/**
 * POST /api/pipeline/[denialId]
 *
 * Runs the pipeline on one case and streams stage events as they land
 * (PRD 7, orchestrator). The run is persisted by the orchestrator regardless
 * of whether the client stays connected, so a closed tab does not lose a run
 * that cost real money.
 *
 * Events are server-sent: one JSON object per `data:` line. The final event is
 * `run_completed` or `run_failed`, after which the stream closes.
 */

// A run takes about a minute; never let a cache serve it.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sseChunk(event: StageEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(_request: NextRequest, ctx: RouteContext<"/api/pipeline/[denialId]">) {
  const { denialId } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StageEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseChunk(event)));
        } catch {
          // The client went away mid-run. The orchestrator keeps going and
          // still persists the run; there is just nobody left to tell.
          closed = true;
        }
      };

      try {
        await runPipeline(denialId, { onEvent: send });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({ type: "run_failed", runId: "", stage: null, error: message });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // Already closed by the client disconnecting.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the point of streaming stages.
      "X-Accel-Buffering": "no",
    },
  });
}
