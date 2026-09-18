import { MockBadge } from "@/components/route-badge";
import {
  deltaAgainst,
  EVAL_GROUPS,
  EVAL_BANNER,
  formatMetric,
  HISTORY_KEYS,
  pickBaseline,
  REFERENCE_NOTE,
  specByKey,
  specsFor,
  type DeltaTone,
  type EvalMetrics,
} from "@/lib/eval/metrics";
import { cn } from "@/lib/utils";

/**
 * Eval dashboard (PRD 6.5). Latest run in full, prior runs in a history table.
 *
 * Colour on this screen means movement against a baseline, never a pass mark.
 * The baseline is the reference run (PRD 9.3); when the latest run is itself
 * the reference, it is the run before it.
 */

export interface EvalRunView {
  id: string;
  createdAt: Date;
  split: string;
  caseCount: number;
  promptVersion: string;
  modelSet: string;
  reference: boolean;
  /** Null when metricsJson did not match the contract in src/lib/eval/metrics.ts. */
  metrics: EvalMetrics | null;
}

const TONE_CLASS: Record<DeltaTone, string> = {
  better: "text-green-700",
  worse: "text-red-700",
  flat: "text-zinc-400",
  none: "text-zinc-400",
};

const KIND_CLASS = {
  RULES: "text-zinc-600 border-zinc-300",
  LLM: "text-violet-700 border-violet-200",
  PIPELINE: "text-blue-700 border-blue-200",
} as const;

function runTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

function ReferenceBadge() {
  return (
    <span className="inline-flex h-[20px] items-center rounded-[4px] border border-zinc-300 bg-white px-[7px] font-mono text-[10px] font-semibold text-zinc-700">
      REFERENCE
    </span>
  );
}

function LatestBadge() {
  return (
    <span className="inline-flex h-[20px] items-center rounded-[4px] border border-green-200 bg-green-50 px-[7px] font-mono text-[10px] font-semibold text-green-700">
      LATEST
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[7px] border border-dashed border-zinc-300 bg-zinc-50 px-5 py-10 text-center">
      <div className="text-[13px] font-semibold text-zinc-700">No eval runs yet</div>
      <p className="mx-auto mt-[6px] max-w-[460px] text-[11.5px] leading-[1.6] text-zinc-500">
        The harness writes one run per invocation. Until it has run, this screen stays empty on purpose: there are no
        placeholder metrics here to mistake for measurements.
      </p>
      <code className="mt-[10px] inline-block rounded border border-zinc-200 bg-white px-[8px] py-[4px] font-mono text-[11px] text-zinc-700">
        npm run eval
      </code>
    </div>
  );
}

function UnreadableRun({ id }: { id: string }) {
  return (
    <div className="rounded-[7px] border border-red-200 bg-red-50 px-[12px] py-[10px] text-[11.5px] text-red-800">
      Run <span className="font-mono font-semibold">{id}</span> stored metrics that do not match the contract in{" "}
      <span className="font-mono">src/lib/eval/metrics.ts</span>. Nothing is shown for it rather than a partial or
      guessed reading. Rerun the harness after a metric shape change.
    </div>
  );
}

export function EvalDashboard({ runs }: { runs: EvalRunView[] }) {
  const latest = runs[0] ?? null;
  // Held as its own const so narrowing survives into the map callbacks below.
  const latestMetrics = latest?.metrics ?? null;

  const baselineRun = pickBaseline(runs);
  const baseline = baselineRun?.metrics ?? null;

  return (
    <div className="px-[14px] pt-[14px] pb-10">
      <div className="mb-3 flex items-center gap-[9px] rounded-[7px] border border-amber-200 bg-amber-50 px-[12px] py-[8px]">
        <span className="text-[12px] text-amber-700">&#9432;</span>
        <div className="text-[11.5px] text-amber-900">{EVAL_BANNER}</div>
      </div>

      {!latest ? (
        <EmptyState />
      ) : (
        <>
          <div className="mb-3 flex items-end gap-[10px]">
            <div>
              <h1 className="m-0 text-[17px] font-semibold tracking-tight">
                Eval run <span className="font-mono font-semibold">{latest.id}</span>
              </h1>
              <div className="mt-[3px] font-mono text-[11.5px] text-zinc-500">
                {runTimestamp(latest.createdAt)} &middot; prompt {latest.promptVersion} &middot; {latest.modelSet}{" "}
                &middot; {latest.caseCount} {latest.split} cases
              </div>
            </div>
            <div className="flex-1" />
            <LatestBadge />
            {latest.reference ? <ReferenceBadge /> : null}
          </div>

          {latestMetrics === null ? (
            <UnreadableRun id={latest.id} />
          ) : (
            <>
              <div className="mb-[8px] text-[11px] text-zinc-500">
                {baselineRun ? (
                  <>
                    Change is measured against{" "}
                    <span className="font-mono text-zinc-700">{baselineRun.id}</span>
                    {baselineRun.reference ? " (the reference run)" : " (the previous run)"}. Green and red mean moved, not passed:
                    the PRD sets no absolute target for any stage metric.
                  </>
                ) : (
                  "First run on this set, so there is no baseline to compare against yet."
                )}
              </div>

              <div className="flex flex-col gap-[10px]">
                {EVAL_GROUPS.map((group) => (
                  <div key={group.key} className="overflow-hidden rounded-[7px] border border-zinc-200">
                    <div className="flex items-center gap-[8px] border-b border-zinc-200 bg-zinc-100 px-[11px] py-[7px]">
                      <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-zinc-800 font-mono text-[10.5px] font-semibold text-white">
                        {group.key}
                      </span>
                      <span className="text-[12px] font-semibold">{group.name}</span>
                      <span
                        className={cn(
                          "inline-flex h-[17px] items-center rounded-[3px] border bg-white px-[5px] font-mono text-[9.5px] font-semibold",
                          KIND_CLASS[group.kind],
                        )}
                      >
                        {group.kind}
                      </span>
                    </div>
                    <div className="flex">
                      {specsFor(group.key).map((spec) => {
                        const delta = deltaAgainst(spec, latestMetrics, baseline);
                        return (
                          <div key={spec.key} className="flex-1 border-r border-zinc-100 px-[12px] py-[10px] last:border-r-0">
                            <div className="mb-[3px] text-[10.5px] text-zinc-500">{spec.label}</div>
                            <div className="flex items-baseline gap-[7px]">
                              <div className="font-mono text-[19px] font-semibold tracking-tight">
                                {formatMetric(spec, latestMetrics)}
                              </div>
                              {delta.text ? (
                                <div className={cn("font-mono text-[10.5px]", TONE_CLASS[delta.tone])}>{delta.text}</div>
                              ) : null}
                            </div>
                            <div className="mt-[2px] font-mono text-[10.5px] text-zinc-400">
                              {spec.read(latestMetrics).note}
                            </div>
                            <div className="mt-[4px] text-[10.5px] leading-[1.45] text-zinc-500">
                              {spec.description}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-4 overflow-hidden rounded-[7px] border border-zinc-200">
            <div className="flex items-center gap-[8px] border-b border-zinc-200 bg-zinc-100 px-[12px] py-[8px]">
              <div className="text-[12.5px] font-semibold">Eval history</div>
              <div className="text-[11px] text-zinc-500">Every run on this set, newest first</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-zinc-50 font-mono text-[10px] tracking-wide text-zinc-600 uppercase">
                    <th className="border-b border-zinc-200 px-[10px] py-[6px] text-left font-semibold">Run</th>
                    <th className="border-b border-zinc-200 px-[10px] py-[6px] text-left font-semibold">Date</th>
                    <th className="border-b border-zinc-200 px-[10px] py-[6px] text-left font-semibold">Prompt</th>
                    <th className="border-b border-zinc-200 px-[10px] py-[6px] text-left font-semibold">Model set</th>
                    {HISTORY_KEYS.map((key) => (
                      <th key={key} className="border-b border-zinc-200 px-[10px] py-[6px] text-right font-semibold">
                        {specByKey(key)?.short ?? key}
                      </th>
                    ))}
                    <th className="border-b border-zinc-200 px-[10px] py-[6px] text-left font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className={cn(run.id === latest.id && "bg-slate-50")}>
                      <td className="border-b border-zinc-100 px-[10px] py-[7px] font-mono text-[11px] font-semibold">
                        {run.id}
                      </td>
                      <td className="border-b border-zinc-100 px-[10px] py-[7px] font-mono text-[11px] whitespace-nowrap text-zinc-500">
                        {runTimestamp(run.createdAt)}
                      </td>
                      <td className="border-b border-zinc-100 px-[10px] py-[7px] font-mono text-[11px]">
                        {run.promptVersion}
                      </td>
                      <td className="border-b border-zinc-100 px-[10px] py-[7px] text-[11px] whitespace-nowrap text-zinc-700">
                        {run.modelSet}
                      </td>
                      {HISTORY_KEYS.map((key) => {
                        const spec = specByKey(key);
                        return (
                          <td
                            key={key}
                            className="border-b border-zinc-100 px-[10px] py-[7px] text-right font-mono text-[11px]"
                          >
                            {run.metrics && spec ? formatMetric(spec, run.metrics) : "—"}
                          </td>
                        );
                      })}
                      <td className="border-b border-zinc-100 px-[10px] py-[7px]">
                        <span className="flex gap-[4px]">
                          {run.id === latest.id ? <LatestBadge /> : null}
                          {run.reference ? <ReferenceBadge /> : null}
                          {run.metrics === null ? <MockBadge label="UNREADABLE" /> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-zinc-200 bg-zinc-50 px-[12px] py-[8px] text-[11px] text-zinc-500">
              {REFERENCE_NOTE}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
