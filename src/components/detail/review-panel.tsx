"use client";

import { useState } from "react";
import { formatCost, formatSeconds } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import { STAGE_META, STAGE_ORDER, draftOutput, type RunView } from "./types";

/**
 * Review panel (PRD 6.3). Tabs over a completed run.
 *
 * Draft and Run log here. The evidence matrix, citation chips and the
 * approve / edit / escalate actions arrive with the review-panel screen.
 */

export function ReviewPanel({ run, denialId }: { run: RunView | null; denialId: string }) {
  const [tab, setTab] = useState<"draft" | "log">("draft");
  const draft = draftOutput(run);

  if (!run || !draft) {
    return (
      <div className="rounded-[7px] border border-zinc-200 bg-zinc-50 px-[10px] py-6 text-center text-[12px] text-zinc-500">
        No draft for this case. Run the pipeline to produce one.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-[10px] flex items-center gap-[2px]">
        {(["draft", "log"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "h-[26px] rounded-[5px] px-[10px] text-[12px] font-medium",
              tab === key ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-50",
            )}
          >
            {key === "draft" ? "Draft" : "Run log"}
          </button>
        ))}
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-zinc-400">{denialId}</span>
      </div>

      {tab === "draft" ? (
        <div className="rounded-[7px] border border-zinc-200 bg-white">
          <pre className="max-h-[620px] overflow-auto px-[12px] py-[10px] font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap text-zinc-800">
            {draft.letterText}
          </pre>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[7px] border border-zinc-200">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-zinc-50 text-left font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                <th className="px-[9px] py-[6px] font-semibold">Stage</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Latency</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Tokens in</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Tokens out</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.map((stage) => {
                const row = run.stages.find((s) => s.stage === stage);
                const meta = STAGE_META[stage];
                return (
                  <tr key={stage} className={cn("border-t border-zinc-100", row?.skipped && "text-zinc-400")}>
                    <td className="px-[9px] py-[6px]">
                      <span className="font-mono text-[10.5px] text-zinc-500">{meta.letter}</span>{" "}
                      <span className="text-zinc-700">{meta.title}</span>
                      {row?.skipped ? <span className="ml-2 font-mono text-[10px]">skipped</span> : null}
                    </td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{formatSeconds(row?.ms)}</td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{row?.tokensIn ?? 0}</td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{row?.tokensOut ?? 0}</td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{formatCost(row?.cost)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-zinc-200 bg-zinc-50 font-medium">
                <td className="px-[9px] py-[6px]">Total</td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">{formatSeconds(run.totalMs)}</td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">
                  {run.stages.reduce((n, s) => n + s.tokensIn, 0)}
                </td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">
                  {run.stages.reduce((n, s) => n + s.tokensOut, 0)}
                </td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">{formatCost(run.totalCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
