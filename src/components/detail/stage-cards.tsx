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

/**
 * Citations in a draft: every chart line and clause id an assertion carries.
 * The same count stage E validates, shown while the draft is still arriving.
 */
function countCitations(draft: ReturnType<typeof draftOutput>): number {
  if (!draft) return 0;
  return draft.draft.sections.reduce(
    (total, section) =>
      total +
      section.assertions.reduce((n, a) => n + a.chart_line_ids.length + a.clause_ids.length, 0),
    0,
  );
}

/**
 * The one-line result shown in a collapsed card's header, so a cached run reads
 * top to bottom without opening anything.
 */
function stageSummary(stage: Stage, run: RunView | null): string | null {
  const triage = triageOutput(run);
  const classify = classifyOutput(run);
  const retrieve = retrieveOutput(run);
  const draft = draftOutput(run);
  const verify = verifyOutput(run);

  switch (stage) {
    case "a_triage":
      return triage
        ? `${triage.decision.replace(/_/g, " ")} · ${formatDollars(triage.expected_value)} EV`
        : null;
    case "b_classify":
      return classify
        ? `${classify.category.replace(/_/g, " ")} · ${classify.root_cause.replace(/_/g, " ")} · ${classify.confidence.toFixed(2)}`
        : null;
    case "c_retrieve":
      return retrieve
        ? `${retrieve.clauses.length} clauses (${retrieve.clauses.filter((c) => c.required).length} required) · ${retrieve.precedents.length} precedents`
        : null;
    case "d_draft":
      return draft
        ? `${draft.draft.sections.reduce((n, s) => n + s.assertions.length, 0)} assertions · ${countCitations(draft)} citations`
        : null;
    case "e_verify":
      return verify
        ? `validity ${formatPercent(verify.citation.validityRate)} · coverage ${formatPercent(verify.coverage.coverage)}` +
            (verify.judge ? ` · judge ${verify.judge.overall.toFixed(2)}` : " · judge skipped")
        : null;
  }
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      <span className="relative h-[6px] w-[110px] overflow-hidden rounded-full bg-zinc-200">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
            value >= 0.85 ? "bg-green-600" : value >= 0.6 ? "bg-amber-500" : "bg-red-500",
          )}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </span>
      <span className="font-mono text-[11.5px] tabular-nums">{value.toFixed(2)}</span>
    </span>
  );
}

/** Shown inside a stage that is running and has nothing to display yet. */
function Working({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[7px] text-[11.5px] text-zinc-500">
      <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-blue-500" />
      {label}
    </div>
  );
}

function StageCard({
  stage,
  status,
  elapsed,
  summary,
  expanded,
  onToggle,
  children,
}: {
  stage: Stage;
  status: StageStatus;
  elapsed: string;
  summary: string | null;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const meta = STAGE_META[stage];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[7px] border bg-white transition-colors duration-300",
        status === "running" ? "border-blue-300 shadow-[0_0_0_3px_rgba(59,130,246,0.08)]" : "border-zinc-200",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center gap-2 px-[10px] py-[8px] text-left",
          status === "done" ? "bg-zinc-50/60" : status === "running" ? "bg-blue-50/40" : "bg-zinc-50",
          "hover:bg-zinc-100/70",
        )}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-white">
          {meta.letter}
        </span>
        <span className="text-[12.5px] font-semibold">{meta.title}</span>
        <span className="inline-flex h-[17px] items-center rounded-[3px] border border-zinc-300 bg-white px-[5px] font-mono text-[9.5px] font-semibold text-zinc-600">
          {meta.kind}
        </span>
        {!expanded && summary ? (
          <span className="truncate text-[11.5px] text-zinc-600">{summary}</span>
        ) : null}
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
        <span className={cn("text-[10px] text-zinc-400 transition-transform", expanded && "rotate-90")}>
          &#9654;
        </span>
      </button>
      {expanded && children ? (
        <div className="border-t border-zinc-100 px-[10px] py-[9px]">{children}</div>
      ) : null}
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
  expanded,
  onToggle,
  draftPreview,
}: {
  run: RunView | null;
  statuses: Record<Stage, StageStatus>;
  liveElapsed: Partial<Record<Stage, number>>;
  thresholdCents: number;
  expanded: Record<Stage, boolean>;
  onToggle: (stage: Stage) => void;
  /** Tail of the draft text as it streams. Empty outside a live run. */
  draftPreview: string;
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
        const running = status === "running";

        return (
          <StageCard
            key={stage}
            stage={stage}
            status={status}
            elapsed={elapsedFor(stage)}
            summary={stageSummary(stage, run)}
            expanded={expanded[stage] ?? false}
            onToggle={() => onToggle(stage)}
          >
            {stage === "a_triage" && triage ? (
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
                <Row label="Confidence">
                  <ConfidenceBar value={classify.confidence} />
                </Row>
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
                <div className="mt-[7px] mb-[4px] flex items-baseline gap-[8px]">
                  <span className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                    Clauses ({retrieve.clauses.length}, {retrieve.clauses.filter((c) => c.required).length} required)
                  </span>
                  {retrieve.clauses.length > 0 ? (
                    <span className="font-mono text-[10px] text-zinc-400">
                      top similarity {Math.max(...retrieve.clauses.map((c) => c.score)).toFixed(3)}
                    </span>
                  ) : null}
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
                <div className="mt-[8px] mb-[4px] flex items-baseline gap-[8px]">
                  <span className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                    Precedents ({retrieve.precedents.length})
                  </span>
                  {retrieve.precedents.length > 0 ? (
                    <span className="font-mono text-[10px] text-zinc-400">
                      top similarity {Math.max(...retrieve.precedents.map((p) => p.score)).toFixed(3)}
                    </span>
                  ) : null}
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
                <Row label="Citations">{countCitations(draft)} chart lines and clauses cited</Row>
                <Row label="Confidence">
                  <ConfidenceBar value={draft.draft.draft_confidence} />
                </Row>
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
            ) : running && stage === "d_draft" ? (
              // The only stage with something to show before it finishes.
              <div>
                <div className="mb-[6px] flex items-center gap-[7px] text-[11.5px] text-zinc-500">
                  <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-blue-500" />
                  drafting, {draftPreview.length > 0 ? "streaming" : "waiting for the first token"}
                </div>
                {draftPreview ? (
                  <div className="max-h-[132px] overflow-hidden rounded-[5px] border border-zinc-200 bg-zinc-50 px-[8px] py-[6px] font-mono text-[10.5px] leading-[1.55] text-zinc-600">
                    {draftPreview}
                    <span className="ml-[2px] inline-block h-[11px] w-[6px] translate-y-[1px] animate-pulse bg-zinc-400" />
                  </div>
                ) : null}
              </div>
            ) : running ? (
              <Working
                label={
                  stage === "b_classify"
                    ? "reading the denial letter"
                    : stage === "c_retrieve"
                      ? "embedding the query and searching criteria"
                      : stage === "e_verify"
                        ? "checking citations, then the judge"
                        : "working"
                }
              />
            ) : status === "skipped" ? (
              <div className="text-[11.5px] text-zinc-500">Skipped: triage stopped the run.</div>
            ) : status === "pending" ? (
              <div className="text-[11.5px] text-zinc-400">Not started.</div>
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
