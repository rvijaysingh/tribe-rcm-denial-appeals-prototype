/**
 * Shapes the detail and review screens read from a persisted run.
 *
 * Stage outputs are stored as JSON, so these describe what the orchestrator
 * wrote rather than being inferred. Everything is optional-safe: a run that
 * stopped at triage has no draft, and the UI must render that rather than
 * throw.
 */

import type { Stage } from "@/lib/domain";
import type { TriageOutput } from "@/lib/pipeline/a-triage";
import type { ClassifyOutput } from "@/lib/pipeline/b-classify";
import type { RetrieveOutput } from "@/lib/pipeline/c-retrieve";
import type { Draft } from "@/lib/pipeline/draft-schema";
import type { VerifyResult } from "@/lib/pipeline/e-verify";

export interface StageView {
  stage: Stage;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  cost: string;
  skipped: boolean;
  output: unknown;
}

export interface RunView {
  id: string;
  route: string | null;
  routeReason: string | null;
  totalMs: number | null;
  totalCost: string | null;
  completedAt: string | null;
  promptVersion: string;
  modelSet: string;
  stages: StageView[];
}

export interface ChartLineView {
  label: string;
  lineNo: number;
  docType: string;
  text: string;
}

export function stageOf(run: RunView | null, stage: Stage): StageView | null {
  return run?.stages.find((s) => s.stage === stage) ?? null;
}

export function triageOutput(run: RunView | null): TriageOutput | null {
  return (stageOf(run, "a_triage")?.output as TriageOutput | undefined) ?? null;
}

export function classifyOutput(run: RunView | null): ClassifyOutput | null {
  return (stageOf(run, "b_classify")?.output as ClassifyOutput | undefined) ?? null;
}

export function retrieveOutput(run: RunView | null): RetrieveOutput | null {
  return (stageOf(run, "c_retrieve")?.output as RetrieveOutput | undefined) ?? null;
}

export function draftOutput(run: RunView | null): { draft: Draft; letterText: string } | null {
  return (stageOf(run, "d_draft")?.output as { draft: Draft; letterText: string } | undefined) ?? null;
}

export function verifyOutput(run: RunView | null): VerifyResult | null {
  return (stageOf(run, "e_verify")?.output as VerifyResult | undefined) ?? null;
}

export const STAGE_META: Record<Stage, { letter: string; title: string; kind: "RULES" | "LLM" | "VECTOR" }> = {
  a_triage: { letter: "A", title: "Triage", kind: "RULES" },
  b_classify: { letter: "B", title: "Classify", kind: "LLM" },
  c_retrieve: { letter: "C", title: "Retrieve", kind: "VECTOR" },
  d_draft: { letter: "D", title: "Draft", kind: "LLM" },
  e_verify: { letter: "E", title: "Verify and route", kind: "LLM" },
};

export const STAGE_ORDER: Stage[] = ["a_triage", "b_classify", "c_retrieve", "d_draft", "e_verify"];
