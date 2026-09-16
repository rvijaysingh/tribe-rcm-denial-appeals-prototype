import { AppShell } from "@/components/app-shell";
import { EvalDashboard, type EvalRunView } from "@/components/evals/eval-dashboard";
import { loadEvalRuns } from "@/lib/db/queries";
import { readEvalMetrics } from "@/lib/eval/metrics";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const rows = await loadEvalRuns();
  const runs: EvalRunView[] = rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.createdAt),
    split: row.split,
    caseCount: row.caseCount,
    promptVersion: row.promptVersion,
    modelSet: row.modelSet,
    reference: row.reference,
    metrics: readEvalMetrics(row.metricsJson),
  }));

  return (
    <AppShell pathname="/dashboard/evals">
      <EvalDashboard runs={runs} />
    </AppShell>
  );
}
