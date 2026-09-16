import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AccountDetail } from "@/components/detail/account-detail";
import { getPayerNotes, loadLatestRun, loadPipelineCase, payerOverturnRate } from "@/lib/db/queries";
import { CONDITION_LABEL } from "@/lib/domain";
import { triage } from "@/lib/pipeline/a-triage";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({ params }: PageProps<"/accounts/[denialId]">) {
  const { denialId } = await params;

  const pipelineCase = await loadPipelineCase(denialId).catch(() => null);
  if (!pipelineCase) notFound();

  const [notes, latestRun, overturnRate] = await Promise.all([
    getPayerNotes(pipelineCase.denial.payerId, pipelineCase.account.condition),
    loadLatestRun(denialId),
    // PRD 6.3: the review panel warns when this payer rarely overturns this
    // category, so a nurse knows the odds before spending time on the letter.
    payerOverturnRate(pipelineCase.denial.payerId, pipelineCase.denial.category),
  ]);

  const decision = triage({
    payerId: pipelineCase.denial.payerId,
    category: pipelineCase.denial.category,
    amount: pipelineCase.denial.amount,
    receivedDate: pipelineCase.denial.receivedDate,
    deadlineDays: pipelineCase.payer.deadlineDays,
    eligible: pipelineCase.denial.eligible,
  });

  return (
    <AppShell pathname={`/accounts/${denialId}`}>
      <AccountDetail
        denialId={denialId}
        accountId={pipelineCase.account.id}
        split={pipelineCase.denial.split}
        payerName={pipelineCase.payer.name}
        criteriaStyle={pipelineCase.payer.criteriaStyle}
        appealFormatNotes={pipelineCase.payer.appealFormatNotes}
        conditionLabel={CONDITION_LABEL[pipelineCase.account.condition]}
        category={pipelineCase.denial.category}
        amount={pipelineCase.denial.amount}
        carc={pipelineCase.denial.carc}
        rarc={pipelineCase.denial.rarc}
        letterText={pipelineCase.denial.letterText}
        chart={pipelineCase.chart.map((line) => ({
          label: line.label,
          lineNo: line.lineNo,
          docType: line.docType,
          text: line.text,
        }))}
        payerNotes={notes}
        payerOverturnRate={overturnRate}
        patient={{
          mrn: pipelineCase.account.mrn,
          age: pipelineCase.account.patientAge,
          drg: pipelineCase.account.drg,
          admitDate: pipelineCase.account.admitDate.toISOString(),
          dischargeDate: pipelineCase.account.dischargeDate.toISOString(),
        }}
        triage={decision}
        initialRun={
          latestRun
            ? {
                id: latestRun.id,
                route: latestRun.route,
                routeReason: latestRun.routeReason,
                totalMs: latestRun.totalMs,
                totalCost: latestRun.totalCost,
                completedAt: latestRun.completedAt?.toISOString() ?? null,
                promptVersion: latestRun.promptVersion,
                modelSet: latestRun.modelSet,
                stages: latestRun.stages.map((s) => ({
                  stage: s.stage,
                  ms: s.ms,
                  tokensIn: s.tokensIn,
                  tokensOut: s.tokensOut,
                  cost: s.cost,
                  skipped: s.skipped,
                  output: s.outputJson,
                })),
              }
            : null
        }
        demoControls={process.env.NEXT_PUBLIC_DEMO_CONTROLS === "true"}
      />
    </AppShell>
  );
}
