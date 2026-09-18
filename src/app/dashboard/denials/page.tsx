import { AppShell } from "@/components/app-shell";
import { LeversTable } from "@/components/dashboard/levers-table";
import { LineChart } from "@/components/dashboard/line-chart";
import { MockBadge, RouteBadge } from "@/components/route-badge";
import { percentDelta } from "@/lib/dashboard/chart";
import { recoveryRateHistory, rnTouchTimeHistory, seriesMean } from "@/lib/dashboard/series";
import { loadMeasuredMetrics, loadRnTouchTimeToday, loadWorkqueue } from "@/lib/db/queries";
import { OLD_CAPACITY_CUTOFF } from "@/lib/economics";
import { triage } from "@/lib/pipeline/a-triage";
import { COST_PER_CASE_CAVEAT } from "@/lib/targets";
import { formatCost, formatDollars, formatPercent, formatSeconds } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const ROUTES = ["ready", "needs_review", "needs_docs", "do_not_appeal"] as const;

function Metric({ label, value, sub, muted }: { label: string; value: string; sub?: string; muted?: boolean }) {
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

function ChartCard({
  title,
  badge,
  children,
  footer,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-[12px] py-[10px]">
      <div className="mb-[6px] flex items-center gap-[8px]">
        <span className="text-[12.5px] font-semibold">{title}</span>
        {badge ? <MockBadge label={badge} /> : null}
      </div>
      {children}
      <div className="mt-[6px] text-[10.5px] leading-[1.5] text-zinc-500">{footer}</div>
    </div>
  );
}

export default async function DenialsDashboardPage() {
  const [metrics, queue, touchToday] = await Promise.all([
    loadMeasuredMetrics(),
    loadWorkqueue(),
    loadRnTouchTimeToday(),
  ]);
  const now = new Date();

  const touchHistory = rnTouchTimeHistory(now);
  const touchAverage = seriesMean(touchHistory);
  const recovery = recoveryRateHistory(now);

  const todayDelta =
    touchToday.meanMinutes === null ? null : percentDelta(touchToday.meanMinutes, touchAverage);

  // What the pipeline would work against what the old cutoff allowed.
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
    <AppShell pathname="/dashboard/denials">
      <div className="px-[14px] pt-[14px] pb-10">
        <div className="mb-3">
          <h1 className="m-0 text-[17px] font-semibold tracking-tight">Claim Denial Dashboard</h1>
          <div className="mt-[3px] text-[11.5px] text-zinc-500">
            What this prototype measured, against the Phase 1 levers it is meant to move.
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <ChartCard
            title="RN touch time per appeal (daily average)"
            footer={
              <>
                Minutes from opening an account to approving its draft. Historical points are mock; today&rsquo;s point
                is measured from this prototype&rsquo;s approvals. Edits and escalations are excluded, since they are
                different work.
              </>
            }
          >
            <LineChart
              points={touchHistory}
              formatValue={(v) => `${Math.round(v)}m`}
              references={[{ value: touchAverage, label: `4-week average: ~${Math.round(touchAverage)} min` }]}
              highlight={
                touchToday.meanMinutes === null
                  ? undefined
                  : {
                      value: touchToday.meanMinutes,
                      label: "Today",
                      caption: todayDelta === null ? undefined : `${todayDelta > 0 ? "+" : ""}${todayDelta.toFixed(0)}%`,
                    }
              }
            />
            <div className="mt-[2px] flex items-center gap-[10px] text-[10.5px]">
              <span className="flex items-center gap-[5px] text-zinc-500">
                <span className="inline-block h-[2px] w-[14px] bg-zinc-500" /> Manual process (mock history)
              </span>
              {touchToday.meanMinutes === null ? (
                <span className="text-zinc-400">No approvals yet today</span>
              ) : (
                <span className="flex items-center gap-[5px] font-medium text-blue-700">
                  <span className="inline-block h-[7px] w-[7px] rounded-full bg-blue-600" />
                  Today, measured over {touchToday.approvals} approval{touchToday.approvals === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </ChartCard>

          <ChartCard
            title="Denied dollar recovery rate (trailing 12 months)"
            badge="MOCK HISTORY"
            footer={
              <>
                $ overturned / $ initially denied, dollar-weighted. Payer outcomes lag 45 to 60 days and are not
                measurable in this prototype, so nothing in the demo moves this chart.
              </>
            }
          >
            <LineChart
              points={recovery}
              formatValue={(v) => `${v.toFixed(0)}%`}
              references={[
                { value: 55, label: "2027 target: 55%", tone: "target" },
                { value: 60, label: "2028 target: 60%", tone: "target" },
              ]}
            />
            <div className="mt-[2px] text-[10.5px] text-zinc-500">
              <span className="inline-block h-[2px] w-[14px] bg-zinc-500 align-middle" /> TTM recovery rate (mock
              history)
            </div>
          </ChartCard>
        </div>

        <div className="mb-4">
          <LeversTable
            measured={{
              costPerCase: metrics.medianCostUsd === null ? undefined : formatCost(metrics.medianCostUsd),
              rnTouchTime:
                touchToday.meanMinutes === null ? undefined : `${touchToday.meanMinutes.toFixed(1)} min`,
            }}
          />
        </div>

        <section>
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
              label="RN touch time today"
              value={touchToday.meanMinutes === null ? "—" : `${touchToday.meanMinutes.toFixed(1)} min`}
              sub={
                touchToday.approvals === 0
                  ? "no approvals yet today"
                  : `mean open-to-approve over ${touchToday.approvals}`
              }
              muted={touchToday.meanMinutes === null}
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
              sub={`new triage vs the old ${formatDollars(OLD_CAPACITY_CUTOFF)} cutoff`}
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
      </div>
    </AppShell>
  );
}
