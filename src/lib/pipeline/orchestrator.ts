/**
 * Pipeline orchestrator (PRD 7).
 *
 * Fixed sequence, no autonomous tool use: A, then B, C, D, E. Every stage is
 * persisted with its inputs, outputs, latency, tokens and cost, so the UI reads
 * from the database rather than from memory and a run can be reopened later.
 *
 * If stage A returns do_not_appeal the run ends there with zero LLM cost, and
 * B to E are recorded as skipped rather than silently missing.
 *
 * Events are emitted for the SSE stream the UI will consume in M3. The CLI uses
 * the same events to print progress.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { loadPipelineCase, type PipelineCase } from "../db/queries";
import { pipelineRuns, stageOutputs } from "../db/schema";
import { CONDITION_LABEL, ROOT_CAUSE_STATEMENT, type Route, type Stage } from "../domain";
import { modelSet } from "../models";
import { renderLetter } from "../render/letter";
import { triage, type TriageOutput } from "./a-triage";
import { classify, CLASSIFY_PROMPT_VERSION, type ClassifyOutput } from "./b-classify";
import { formatChartForPrompt, retrieve, type RetrieveOutput } from "./c-retrieve";
import { draft, DRAFT_PROMPT_VERSION } from "./d-draft";
import type { Draft } from "./draft-schema";
import { verify, VERIFY_PROMPT_VERSION, type VerifyPhase, type VerifyResult } from "./e-verify";

export const PROMPT_VERSION = `${CLASSIFY_PROMPT_VERSION}+${DRAFT_PROMPT_VERSION}+${VERIFY_PROMPT_VERSION}`;

export type StageEvent =
  | { type: "stage_started"; stage: Stage }
  /**
   * `output` is the same payload persisted to stage_outputs. The UI needs it to
   * render a stage as it lands: without it a live run has nothing to show until
   * the page refetches, so every stage looks empty while it runs.
   */
  | { type: "stage_completed"; stage: Stage; ms: number; skipped: boolean; summary: string; output?: unknown }
  /** Something worth showing partway through a stage, such as stage E's gates. */
  | { type: "stage_progress"; stage: Stage; phase: VerifyPhase }
  | { type: "draft_token"; text: string }
  | { type: "run_completed"; runId: string; route: Route; totalMs: number; totalCostUsd: number }
  | { type: "run_failed"; runId: string; stage: Stage | null; error: string };

export interface RunOptions {
  onEvent?: (event: StageEvent) => void;
  /** Injectable clock, so triage is reproducible in tests and evals. */
  now?: Date;
}

export interface RunResult {
  runId: string;
  denialId: string;
  route: Route;
  routeReason: string;
  totalMs: number;
  totalCostUsd: number;
  triage: TriageOutput;
  classify: ClassifyOutput | null;
  retrieval: RetrieveOutput | null;
  draft: Draft | null;
  letterText: string | null;
  verification: VerifyResult | null;
}

interface StageRecord {
  stage: Stage;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  skipped: boolean;
  input: unknown;
  output: unknown;
}

function newRunId(denialId: string): string {
  return `RUN-${denialId}-${Date.now().toString(36).toUpperCase()}`;
}

/** Letter context from the case record. */
export function letterContextFor(pipelineCase: PipelineCase) {
  return {
    payerName: pipelineCase.payer.name,
    accountId: pipelineCase.account.id,
    denialId: pipelineCase.denial.id,
    memberReference: pipelineCase.account.mrn,
    conditionLabel: CONDITION_LABEL[pipelineCase.account.condition],
    drg: pipelineCase.account.drg,
    admitDate: pipelineCase.account.admitDate,
    dischargeDate: pipelineCase.account.dischargeDate,
    carc: pipelineCase.denial.carc,
    rarc: pipelineCase.denial.rarc,
  };
}

/** Run the full pipeline on one denial and persist every stage. */
export async function runPipeline(denialId: string, options: RunOptions = {}): Promise<RunResult> {
  const db = getDb();
  const emit = (event: StageEvent) => options.onEvent?.(event);
  const pipelineCase = await loadPipelineCase(denialId);

  const runId = newRunId(denialId);
  const startedAt = new Date();
  await db.insert(pipelineRuns).values({
    id: runId,
    denialId,
    status: "running",
    startedAt,
    promptVersion: PROMPT_VERSION,
    modelSet: modelSet(),
  });

  const records: StageRecord[] = [];
  const persist = async (record: StageRecord): Promise<void> => {
    records.push(record);
    await db.insert(stageOutputs).values({
      id: `${runId}-${record.stage}`,
      runId,
      stage: record.stage,
      inputJson: record.input as never,
      outputJson: record.output as never,
      ms: record.ms,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      cost: record.costUsd.toFixed(6),
      skipped: record.skipped,
    });
  };

  const finish = async (route: Route, routeReason: string, result: Omit<RunResult, "runId" | "denialId" | "route" | "routeReason" | "totalMs" | "totalCostUsd">): Promise<RunResult> => {
    const totalMs = Date.now() - startedAt.getTime();
    const totalCostUsd = records.reduce((sum, r) => sum + r.costUsd, 0);
    await db
      .update(pipelineRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        totalMs,
        totalCost: totalCostUsd.toFixed(6),
        route,
        routeReason,
      })
      .where(eq(pipelineRuns.id, runId));
    emit({ type: "run_completed", runId, route, totalMs, totalCostUsd });
    return { runId, denialId, route, routeReason, totalMs, totalCostUsd, ...result };
  };

  let currentStage: Stage | null = null;
  try {
    // ---- Stage A: triage
    currentStage = "a_triage";
    emit({ type: "stage_started", stage: "a_triage" });
    const aStarted = Date.now();
    const triageInput = {
      payerId: pipelineCase.denial.payerId,
      category: pipelineCase.denial.category,
      amount: pipelineCase.denial.amount,
      receivedDate: pipelineCase.denial.receivedDate,
      deadlineDays: pipelineCase.payer.deadlineDays,
      eligible: pipelineCase.denial.eligible,
    };
    const triageOutput = triage(triageInput, options.now);
    const aMs = Date.now() - aStarted;
    await persist({
      stage: "a_triage",
      ms: aMs,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      skipped: false,
      input: triageInput,
      output: triageOutput,
    });
    emit({
      type: "stage_completed",
      stage: "a_triage",
      ms: aMs,
      skipped: false,
      summary: `${triageOutput.decision}: ${triageOutput.reason}`,
      output: triageOutput,
    });

    if (triageOutput.decision === "do_not_appeal") {
      // Record the rest as skipped rather than leaving gaps the UI must guess at.
      for (const stage of ["b_classify", "c_retrieve", "d_draft", "e_verify"] as const) {
        await persist({
          stage,
          ms: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          skipped: true,
          input: null,
          output: null,
        });
        emit({
          type: "stage_completed",
          stage,
          ms: 0,
          skipped: true,
          summary: "skipped: triage stopped the run",
          output: null,
        });
      }
      return finish("do_not_appeal", triageOutput.reason, {
        triage: triageOutput,
        classify: null,
        retrieval: null,
        draft: null,
        letterText: null,
        verification: null,
      });
    }

    // ---- Stage B: classify
    currentStage = "b_classify";
    emit({ type: "stage_started", stage: "b_classify" });
    const classifyInput = {
      conditionLabel: CONDITION_LABEL[pipelineCase.account.condition],
      carc: pipelineCase.denial.carc,
      rarc: pipelineCase.denial.rarc,
      docTypes: pipelineCase.docTypes,
      letterText: pipelineCase.denial.letterText,
    };
    const b = await classify(classifyInput);
    await persist({
      stage: "b_classify",
      ms: b.ms,
      tokensIn: b.tokensIn,
      tokensOut: b.tokensOut,
      costUsd: b.costUsd,
      skipped: false,
      input: { ...classifyInput, letterText: `${classifyInput.letterText.slice(0, 400)}...` },
      output: b.data,
    });
    emit({
      type: "stage_completed",
      stage: "b_classify",
      ms: b.ms,
      skipped: false,
      summary: `${b.data.category} / ${b.data.root_cause}, confidence ${b.data.confidence.toFixed(2)}`,
      output: b.data,
    });

    // ---- Stage C: retrieve
    currentStage = "c_retrieve";
    emit({ type: "stage_started", stage: "c_retrieve" });
    const cStarted = Date.now();
    const retrieveInput = {
      payerId: pipelineCase.denial.payerId,
      condition: pipelineCase.account.condition,
      category: b.data.category,
      rootCause: b.data.root_cause,
      keyFacts: b.data.key_facts,
    };
    const c = await retrieve(retrieveInput);
    const cMs = Date.now() - cStarted;
    await persist({
      stage: "c_retrieve",
      ms: cMs,
      tokensIn: c.embeddingTokens,
      tokensOut: 0,
      costUsd: c.costUsd,
      skipped: false,
      input: retrieveInput,
      output: c,
    });
    emit({
      type: "stage_completed",
      stage: "c_retrieve",
      ms: cMs,
      skipped: false,
      summary:
        `${c.clauses.length} clauses (${c.clauses.filter((x) => x.forced).length} forced in as required), ` +
        `${c.precedents.length} precedents`,
      output: c,
    });

    // ---- Stage D: draft
    currentStage = "d_draft";
    emit({ type: "stage_started", stage: "d_draft" });
    const chartText = formatChartForPrompt(pipelineCase.chart);
    const draftInput = {
      payerName: pipelineCase.payer.name,
      appealFormatNotes: pipelineCase.payer.appealFormatNotes,
      conditionLabel: CONDITION_LABEL[pipelineCase.account.condition],
      drg: pipelineCase.account.drg,
      category: b.data.category,
      rootCauseStatement: ROOT_CAUSE_STATEMENT[b.data.root_cause],
      keyFacts: b.data.key_facts,
      clauses: c.clauses,
      precedents: c.precedents,
      chartText,
      requiredClauseIds: c.requiredClauseIds,
    };
    const d = await draft(draftInput, (text) => emit({ type: "draft_token", text }));
    const letterText = renderLetter(d.data, letterContextFor(pipelineCase));
    await persist({
      stage: "d_draft",
      ms: d.ms,
      tokensIn: d.tokensIn,
      tokensOut: d.tokensOut,
      costUsd: d.costUsd,
      skipped: false,
      // The chart is already persisted on the case; storing it again per run
      // would multiply the largest field in the database by the run count.
      input: { ...draftInput, chartText: `${pipelineCase.chart.length} chart lines` },
      output: { draft: d.data, letterText },
    });
    emit({
      type: "stage_completed",
      stage: "d_draft",
      ms: d.ms,
      skipped: false,
      summary:
        `${d.data.sections.reduce((n, s) => n + s.assertions.length, 0)} assertions, ` +
        `confidence ${d.data.draft_confidence.toFixed(2)}` +
        (d.data.unsupported_required.length > 0
          ? `, ${d.data.unsupported_required.length} unsupported required clause(s)`
          : ""),
      output: { draft: d.data, letterText },
    });

    // ---- Stage E: verify and route
    currentStage = "e_verify";
    emit({ type: "stage_started", stage: "e_verify" });
    const eStarted = Date.now();
    const e = await verify({
      draft: d.data,
      validLineNumbers: new Set(pipelineCase.chart.map((l) => l.lineNo)),
      retrievedClauseIds: new Set(c.clauses.map((x) => x.id)),
      requiredClauseIds: c.requiredClauseIds,
      classifyConfidence: b.data.confidence,
      letterText,
      chartText,
      clauses: c.clauses,
      precedents: c.precedents,
    }, undefined, (phase) => emit({ type: "stage_progress", stage: "e_verify", phase }));
    const eMs = Date.now() - eStarted;
    await persist({
      stage: "e_verify",
      ms: eMs,
      tokensIn: e.usage?.tokensIn ?? 0,
      tokensOut: e.usage?.tokensOut ?? 0,
      costUsd: e.usage?.costUsd ?? 0,
      skipped: false,
      input: { requiredClauseIds: c.requiredClauseIds, classifyConfidence: b.data.confidence },
      output: e,
    });
    emit({
      type: "stage_completed",
      stage: "e_verify",
      ms: eMs,
      skipped: false,
      summary:
        `validity ${(e.citation.validityRate * 100).toFixed(0)}%, coverage ${(e.coverage.coverage * 100).toFixed(0)}%` +
        (e.judge ? `, judge ${e.judge.overall.toFixed(2)}, ${e.judge.flagged_assertions.length} flagged` : ", judge skipped") +
        ` -> ${e.decision.route}`,
      output: e,
    });

    return finish(e.decision.route, e.decision.route_reason, {
      triage: triageOutput,
      classify: b.data,
      retrieval: c,
      draft: d.data,
      letterText,
      verification: e,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(pipelineRuns)
      .set({ status: "failed", completedAt: new Date(), errorMessage: message.slice(0, 2000) })
      .where(eq(pipelineRuns.id, runId));
    emit({ type: "run_failed", runId, stage: currentStage, error: message });
    throw error;
  }
}
