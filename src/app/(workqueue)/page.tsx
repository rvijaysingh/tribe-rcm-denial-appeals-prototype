import { AppShell } from "@/components/app-shell";
import { WorkqueueTable, type WorkqueueItem } from "@/components/workqueue/workqueue-table";
import { loadWorkqueue } from "@/lib/db/queries";
import { CONDITION_LABEL } from "@/lib/domain";
import { toCents } from "@/lib/money";
import { triage } from "@/lib/pipeline/a-triage";

// Runs are created while the user watches, so never serve a cached queue.
export const dynamic = "force-dynamic";

export default async function WorkqueuePage() {
  const rows = await loadWorkqueue();
  const now = new Date();

  const items: WorkqueueItem[] = rows.map((row) => {
    // Stage A is pure and deterministic, so the queue can show the triage
    // decision for cases the pipeline has never touched.
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

    return {
      denialId: row.denialId,
      accountId: row.accountId,
      payerName: row.payerName,
      conditionLabel: CONDITION_LABEL[row.condition],
      category: row.category,
      amount: row.amount,
      amountCents: toCents(row.amount),
      daysLeft: decision.days_left,
      triageDecision: decision.decision,
      triageReason: decision.reason,
      expectedValue: decision.expected_value,
      wouldHaveBeenWorkedOld: decision.would_have_been_worked_old,
      route: row.route,
      runStatus: row.runId ? "completed" : (row.runStatus ?? null),
      totalCost: row.totalCost,
      totalMs: row.totalMs,
    };
  });

  // Expected value descending is the default sort (PRD 6.1).
  items.sort((a, b) => b.expectedValue - a.expectedValue);

  return (
    <AppShell pathname="/">
      <WorkqueueTable items={items} />
    </AppShell>
  );
}
