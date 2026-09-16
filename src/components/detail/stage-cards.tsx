"use client";

import { RouteBadge } from "@/components/route-badge";
import type { Stage } from "@/lib/domain";
import { formatCost, formatDollars, formatPercent, formatSeconds } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import {
  STAGE_META,
  STAGE_ORDER,
  classifyOutput,
  draftOutput,
  retrieveOutput,
  stageOf,
  triageOutput,
  verifyOutput,
  type RunView,
} from "./types";

export type StageStatus = "pending" | "running" | "done" | "skipped";

const STATUS_STYLE: Record<StageStatus, string> = {
  pending: "text-zinc-500 bg-zinc-100 border-zinc-200",
  running: "text-blue-700 bg-blue-50 border-blue-200",
  done: "text-green-700 bg-green-50 border-green-200",
  skipped: "text-zinc-400 bg-zinc-50 border-zinc-200",
};

function StageCard({
  stage,
  status,
  elapsed,
  children,
}: {
  stage: Stage;
  status: StageStatus;
  elapsed: string;
  children?: React.ReactNode;
}) {
  const meta = STAGE_META[stage];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[7px] border bg-white",
        status === "running" ? "border-blue-200" : "border-zinc-200",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-[10px] py-[8px]",
          status === "done" ? "bg-zinc-50/60" : status === "running" ? "bg-blue-50/40" : "bg-zinc-50",
        )}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-white">
          {meta.letter}
        </span>
        <span className="text-[12.5px] font-semibold">{meta.title}</span>
        <span className="inline-flex h-[17px] items-center rounded-[3px] border border-zinc-300 bg-white px-[5px] font-mono text-[9.5px] font-semibold text-zinc-600">
          {meta.kind}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-zinc-500">{elapsed}</span>
        <span
          className={cn(
            "inline-flex h-[18px] items-center rounded border px-[6px] font-mono text-[10px] font-semibold",
            STATUS_STYLE[status],
          )}
        >
          {status}
        </span>
      </div>
      {children ? <div className="border-t border-zinc-100 px-[10px] py-[9px]">{children}</div> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-[10px] py-[2px]">
      <span className="w-[104px] shrink-0 text-[11px] text-zinc-500">{label}</span>
      <span className="text-[11.5px] text-zinc-800">{children}</span>
    </div>
  );
}

export function StageCards({
  run,
  statuses,
  liveElapsed,
  thresholdCents,
}: {
  run: RunView | null;
  statuses: Record<Stage, StageStatus>;
  liveElapsed: Partial<Record<Stage, number>>;
  thresholdCents: number;
}) {
  const triage = triageOutput(run);
  const classify = classifyOutput(run);
  const retrieve = retrieveOutput(run);
  const draft = draftOutput(run);
  const verify = verifyOutput(run);

  const elapsedFor = (stage: Stage): string => {
    const status = statuses[stage];
    if (status === "running") return "running…";
    if (status === "skipped") return "skipped";
    const ms = liveElapsed[stage] ?? stageOf(run, stage)?.ms;
    return ms === undefined ? "—" : formatSeconds(ms);
  };

  return (
    <div className="flex flex-col gap-2">
      {STAGE_ORDER.map((stage) => {
        const status = statuses[stage];
        const show = status === "done";

        return (
          <StageCard key={stage} stage={stage} status={status} elapsed={elapsedFor(stage)}>
            {!show ? null : stage === "a_triage" && triage ? (
              <div>
                <div className="mb-[7px] flex flex-wrap items-center gap-[10px]">
                  <span
                    className={cn(
                      "inline-flex h-[19px] items-center rounded border px-[7px] font-mono text-[10.5px] font-semibold",
                      triage.decision === "appeal"
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-zinc-200 bg-zinc-100 text-zinc-600",
                    )}
                  >
                    {triage.decision.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-[11.5px] text-zinc-800">
                    {formatDollars(triage.amount_cents / 100)} x {triage.p_overturn.toFixed(2)} ={" "}
                    <span className="font-semibold text-green-700">{formatDollars(triage.expected_value)}</span> EV
                    <span className="text-zinc-500">
                      {" "}
                      vs {formatDollars(thresholdCents / 100)} cost to work
                    </span>
                  </span>
                </div>
                <div className="text-[11.5px] text-zinc-700">{triage.reason}</div>
                {!triage.would_have_been_worked_old && triage.decision === "appeal" ? (
                  <div className="mt-[8px] flex items-start gap-[7px] rounded-[5px] border border-amber-200 bg-amber-50 px-[8px] py-[6px]">
                    <span className="text-[12px] text-amber-700">&#9873;</span>
                    <span className="text-[11px] leading-[1.55] text-amber-900">
                      <span className="font-mono font-semibold">would_have_been_worked_old = false</span>. This account
                      sits below the old capacity cutoff and would not have been worked under the previous process.
                    </span>
                  </div>
                ) : null}
              </div>
            ) : stage === "b_classify" && classify ? (
              <div>
                <Row label="Category">{classify.category.replace(/_/g, " ")}</Row>
                <Row label="Root cause">{classify.root_cause.replace(/_/g, " ")}</Row>
                <Row label="Confidence">{classify.confidence.toFixed(2)}</Row>
                <div className="mt-[6px] mb-[3px] font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                  Key facts the payer relies on
                </div>
                <ul className="space-y-[3px]">
                  {classify.key_facts.map((fact, i) => (
                    <li key={i} className="flex gap-[6px] text-[11.5px] text-zinc-700">
                      <span className="text-zinc-300">&bull;</span>
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
            ) : stage === "c_retrieve" && retrieve ? (
              <div>
                <Row label="Query">
                  <span className="font-mono text-[11px] text-zinc-600">{retrieve.query}</span>
                </Row>
                <div className="mt-[7px] mb-[4px] font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                  Clauses ({retrieve.clauses.length})
                </div>
                <div className="space-y-[3px]">
                  {retrieve.clauses.map((clause) => (
                    <div key={clause.id} className="flex items-baseline gap-[7px] text-[11.5px]">
                      <span className="font-mono text-[10.5px] text-zinc-400">{clause.id}</span>
                      <span className="font-mono text-[10.5px] text-zinc-600">{clause.code}</span>
                      {clause.required ? (
                        <span className="inline-flex h-[15px] items-center rounded-[3px] border border-zinc-300 bg-zinc-50 px-[4px] font-mono text-[9px] font-semibold text-zinc-600">
                          REQUIRED
                        </span>
                      ) : null}
                      {clause.forced ? (
                        <span
                          className="inline-flex h-[15px] items-center rounded-[3px] border border-blue-200 bg-blue-50 px-[4px] font-mono text-[9px] font-semibold text-blue-700"
                          title="Ranked below the cut but included because it is required."
                        >
                          FORCED IN
                        </span>
                      ) : null}
                      <span className="font-mono text-[10.5px] text-zinc-400">{clause.score.toFixed(3)}</span>
                      <span className="truncate text-zinc-700">{clause.text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-[8px] mb-[4px] font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                  Precedents ({retrieve.precedents.length})
                </div>
                <div className="space-y-[3px]">
                  {retrieve.precedents.map((p) => (
                    <div key={p.id} className="flex items-baseline gap-[7px] text-[11.5px]">
                      <span className="font-mono text-[10.5px] text-zinc-400">{p.id}</span>
                      <span className="font-mono text-[10.5px] text-zinc-400">{p.score.toFixed(3)}</span>
                      <span className="truncate text-zinc-700">{p.summary}</span>
                    </div>
                  ))}
                  {retrieve.precedents.length === 0 ? (
                    <div className="text-[11.5px] text-zinc-500">No overturned precedents for this payer pairing.</div>
                  ) : null}
                </div>
              </div>
            ) : stage === "d_draft" && draft ? (
              <div>
                <Row label="Assertions">
                  {draft.draft.sections.reduce((n, s) => n + s.assertions.length, 0)} across{" "}
                  {draft.draft.sections.length} sections
                </Row>
                <Row label="Confidence">{draft.draft.draft_confidence.toFixed(2)}</Row>
                {draft.draft.unsupported_required.length > 0 ? (
                  <div className="mt-[8px] rounded-[5px] border border-blue-200 bg-blue-50 px-[8px] py-[6px]">
                    <div className="mb-[3px] font-mono text-[9.5px] font-semibold tracking-wide text-blue-800 uppercase">
                      Evidence needed
                    </div>
                    {draft.draft.unsupported_required.map((gap) => (
                      <div key={gap.clause_id} className="text-[11px] leading-[1.55] text-blue-900">
                        <span className="font-mono font-semibold">{gap.clause_id}</span>: {gap.evidence_needed}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : stage === "e_verify" && verify ? (
              <div>
                <Row label="Citation validity">
                  {formatPercent(verify.citation.validityRate)} over {verify.citation.totalCitations} citations
                  {verify.citation.invalidChartLineIds.length + verify.citation.invalidClauseIds.length > 0 ? (
                    <span className="ml-1 text-red-700">
                      (invalid: {[...verify.citation.invalidChartLineIds, ...verify.citation.invalidClauseIds].join(", ")}
                      )
                    </span>
                  ) : null}
                </Row>
                <Row label="Criteria coverage">
                  {formatPercent(verify.coverage.coverage)}
                  {verify.coverage.uncoveredRequiredClauseIds.length > 0 ? (
                    <span className="ml-1 text-zinc-500">
                      (not argued: {verify.coverage.uncoveredRequiredClauseIds.join(", ")})
                    </span>
                  ) : null}
                </Row>
                {verify.judge ? (
                  <>
                    <Row label="Judge">
                      faithfulness {verify.judge.faithfulness.toFixed(2)}, completeness{" "}
                      {verify.judge.completeness.toFixed(2)}, tone {verify.judge.tone.toFixed(2)}, overall{" "}
                      <span className="font-semibold">{verify.judge.overall.toFixed(2)}</span>
                    </Row>
                    {verify.judge.flagged_assertions.length > 0 ? (
                      <div className="mt-[8px] space-y-[6px]">
                        {verify.judge.flagged_assertions.map((flag, i) => (
                          <div key={i} className="rounded-[5px] border border-amber-200 bg-amber-50 px-[8px] py-[6px]">
                            <div className="text-[11px] leading-[1.5] font-medium text-amber-900">
                              &ldquo;{flag.assertion_text}&rdquo;
                            </div>
                            <div className="mt-[3px] text-[11px] leading-[1.5] text-amber-800">{flag.reason}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Row label="Judge">
                    <span className="text-zinc-500">
                      skipped: a required criterion has no chart support, so no letter is going out
                    </span>
                  </Row>
                )}
                <div className="mt-[9px] flex items-center gap-[8px] border-t border-zinc-100 pt-[8px]">
                  <span className="text-[11px] text-zinc-500">Route</span>
                  <RouteBadge route={verify.decision.route} />
                  <span className="text-[11.5px] text-zinc-700">{verify.decision.route_reason}</span>
                </div>
              </div>
            ) : null}
          </StageCard>
        );
      })}

      {run ? (
        <div className="mt-1 flex items-center gap-3 border-t border-zinc-100 pt-2 font-mono text-[10.5px] text-zinc-500">
          <span>run {run.id}</span>
          <span>{formatSeconds(run.totalMs)}</span>
          <span>{formatCost(run.totalCost)}</span>
          <span>{run.modelSet}</span>
          <span>{run.promptVersion}</span>
        </div>
      ) : null}
    </div>
  );
}
