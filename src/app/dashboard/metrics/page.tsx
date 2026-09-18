import { AppShell } from "@/components/app-shell";
import { RouteBadge } from "@/components/route-badge";
import { loadMeasuredMetrics, loadWorkqueue } from "@/lib/db/queries";
import { OLD_CAPACITY_CUTOFF } from "@/lib/economics";
import { triage } from "@/lib/pipeline/a-triage";
import { LeversTable } from "@/components/dashboard/levers-table";
import { COST_PER_CASE_CAVEAT } from "@/lib/targets";
import { formatCost, formatDollars, formatPercent, formatSeconds } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const ROUTES = ["ready", "needs_review", "needs_docs", "do_not_appeal"] as const;

function Metric({
  label,
  value,
  sub,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-[11px] py-[9px]">
      <div className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className={`mt-[3px] text-[20px] font-semibold tracking-tight tabular-nums ${muted ? "text-zinc-400" : ""}`}>
        {value}
      </div>
      {sub ? <div className="mt-[2px] text-[10.5px] leading-[1.45] text-zinc-500">{sub}</div> : null}
    </div>
  );
}

export default async function MetricsPage() {
  const [metrics, queue] = await Promise.all([loadMeasuredMetrics(), loadWorkqueue()]);
  const now = new Date();

  // The threshold story: what the pipeline would work, against what the old
  // capacity cutoff allowed. Both computed from the same triage rule.
  let appealable = 0;
  let workedOld = 0;
  for (const row of queue) {
    const decision = triage(
      {
        payerId: row.payerId,
        category: row.category,
        amount: row.amount,
        receivedDate: new Date(row.receivedDate),
        deadlineDays: row.deadlineDays,
        eligible: row.eligible,
      },
      now,
    );
    if (decision.decision === "appeal") appealable += 1;
    if (decision.would_have_been_worked_old) workedOld += 1;
  }

  const agreement = metrics.reviewedRuns > 0 ? metrics.approvedAsIs / metrics.reviewedRuns : null;

  return (
    <AppShell pathname="/dashboard/metrics">
      <div className="px-[14px] pt-[14px] pb-10">
        <div className="mb-3 flex items-end gap-[10px]">
          <div>
            <h1 className="m-0 text-[17px] font-semibold tracking-tight">Metrics</h1>
            <div className="mt-[3px] text-[11.5px] text-zinc-500">
              Two panels, kept apart on purpose: what this prototype measured, and what the proposal targets.
            </div>
          </div>
        </div>

        <section className="mb-5">
          <div className="mb-[9px] flex items-center gap-[7px]">
            <span className="font-mono text-[11px] font-semibold tracking-wide text-zinc-600 uppercase">
              Measured in this prototype
            </span>
            <span className="inline-flex h-[18px] items-center rounded-[3px] border border-green-200 bg-green-50 px-[5px] font-mono text-[9.5px] font-semibold text-green-700">
              LIVE FROM THE DATABASE
            </span>
            <span className="h-px flex-1 bg-zinc-200" />
          </div>

          <div className="grid grid-cols-4 gap-[10px]">
            <Metric
              label="Cases processed"
              value={String(metrics.casesProcessed)}
              sub={`of ${metrics.totalDenials} denials in the dataset`}
            />
            <Metric
              label="Pipeline seconds"
              value={metrics.medianMs === null ? "—" : formatSeconds(metrics.medianMs)}
              sub={metrics.p90Ms === null ? "no runs yet" : `median, p90 ${formatSeconds(metrics.p90Ms)}`}
              muted={metrics.medianMs === null}
            />
            <Metric
              label="Cost per case"
              value={metrics.medianCostUsd === null ? "—" : formatCost(metrics.medianCostUsd)}
              sub={`median. ${formatCost(metrics.totalCostUsd)} spent across all runs`}
              muted={metrics.medianCostUsd === null}
            />
            <Metric
              label="Citation validity"
              value={formatPercent(metrics.meanValidity)}
              sub={
                metrics.runsWithValidity === 0
                  ? "no verified runs yet"
                  : `${metrics.runsWithPerfectValidity} of ${metrics.runsWithValidity} runs at 100%`
              }
              muted={metrics.meanValidity === null}
            />
            <Metric
              label="Criteria coverage"
              value={formatPercent(metrics.meanCoverage)}
              sub="required clauses argued, mean across runs"
              muted={metrics.meanCoverage === null}
            />
            <Metric
              label="Reviewer minutes"
              value={metrics.meanReviewerMinutes === null ? "—" : metrics.meanReviewerMinutes.toFixed(1)}
              sub={
                metrics.reviewedRuns === 0
                  ? "no reviewed runs yet"
                  : `mean per case, ${metrics.reviewedRuns} reviewed`
              }
              muted={metrics.meanReviewerMinutes === null}
            />
            <Metric
              label="Reviewer agreement"
              value={formatPercent(agreement)}
              sub={
                metrics.reviewedRuns === 0
                  ? "approved as is / all reviewed"
                  : `${metrics.approvedAsIs} approved as is of ${metrics.reviewedRuns}`
              }
              muted={agreement === null}
            />
            <Metric
              label="Denials worked"
              value={`${appealable} vs ${workedOld}`}
              sub={`prototype triage vs the old ${formatDollars(OLD_CAPACITY_CUTOFF)} capacity cutoff`}
            />
          </div>

          <div className="mt-[10px] rounded-md border border-zinc-200 bg-white px-[11px] py-[9px]">
            <div className="mb-[7px] font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
              Route distribution
            </div>
            <div className="flex flex-wrap items-center gap-[14px]">
              {ROUTES.map((route) => (
                <span key={route} className="flex items-center gap-[6px]">
                  <RouteBadge route={route} />
                  <span className="text-[13px] font-semibold tabular-nums">{metrics.routeCounts[route] ?? 0}</span>
                </span>
              ))}
              {metrics.casesProcessed === 0 ? (
                <span className="text-[11.5px] text-zinc-500">No completed runs yet.</span>
              ) : null}
            </div>
          </div>

          <div className="mt-[8px] rounded-md border border-amber-200 bg-amber-50 px-[10px] py-[7px] text-[11px] leading-[1.55] text-amber-900">
            {COST_PER_CASE_CAVEAT}
          </div>
        </section>

        <LeversTable
          measured={{
            costPerCase: metrics.medianCostUsd === null ? undefined : formatCost(metrics.medianCostUsd),
          }}
        />
      </div>
    </AppShell>
  );
}
