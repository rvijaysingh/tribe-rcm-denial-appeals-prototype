"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MockBadge, RouteBadge } from "@/components/route-badge";
import type { Stage } from "@/lib/domain";
import type { TriageOutput } from "@/lib/pipeline/a-triage";
import type { StageEvent } from "@/lib/pipeline/orchestrator";
import { CATEGORY_LABEL, formatCost, formatDollars, formatSeconds } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import { CaseInputs } from "./case-inputs";
import { ReviewPanel } from "./review-panel";
import { StageCards, type StageStatus } from "./stage-cards";
import { STAGE_ORDER, type ChartLineView, type RunView } from "./types";

/**
 * Account detail (PRD 6.2): inputs on the left, pipeline progress on the right.
 *
 * Run live opens an SSE stream and advances the stage cards as events land.
 * The run is persisted server-side, so when the stream finishes the page
 * refreshes from the database rather than trusting what it accumulated in
 * memory: the UI reads from persisted runs, as the PRD requires.
 */

const IDLE: Record<Stage, StageStatus> = {
  a_triage: "pending",
  b_classify: "pending",
  c_retrieve: "pending",
  d_draft: "pending",
  e_verify: "pending",
};

const ALL_DONE: Record<Stage, StageStatus> = {
  a_triage: "done",
  b_classify: "done",
  c_retrieve: "done",
  d_draft: "done",
  e_verify: "done",
};

const ALL_COLLAPSED: Record<Stage, boolean> = {
  a_triage: false,
  b_classify: false,
  c_retrieve: false,
  d_draft: false,
  e_verify: false,
};

/** Only the named stage open, which is how the live run walks down the list. */
function onlyExpanded(stage: Stage): Record<Stage, boolean> {
  return { ...ALL_COLLAPSED, [stage]: true };
}

/** How long the page must sit untouched before a finished demo case resets. */
const AUTO_RESET_IDLE_MS = 10 * 60 * 1000;
/** How often idleness is checked. Coarse on purpose: the deadline is minutes. */
const IDLE_CHECK_MS = 20 * 1000;
/** Anything here counts as the presenter still being on this case. */
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;
/** Pause after the run lands before the review panel takes over (PRD 6.3 flow). */
const AUTO_REVIEW_DELAY_MS = 1500;
/** How much of the streaming draft to keep on screen. */
const DRAFT_PREVIEW_CHARS = 900;

function statusesFromRun(run: RunView | null): Record<Stage, StageStatus> {
  if (!run) return IDLE;
  const next = { ...ALL_DONE };
  for (const stage of STAGE_ORDER) {
    const persisted = run.stages.find((s) => s.stage === stage);
    next[stage] = !persisted ? "pending" : persisted.skipped ? "skipped" : "done";
  }
  return next;
}

export interface AccountDetailProps {
  denialId: string;
  accountId: string;
  split: string;
  payerName: string;
  criteriaStyle: string;
  appealFormatNotes: string;
  conditionLabel: string;
  category: string;
  amount: string;
  carc: string;
  rarc: string;
  letterText: string;
  chart: ChartLineView[];
  payerNotes: { id: string; text: string }[];
  /** Share of this payer's precedents for this category that were overturned. */
  payerOverturnRate: number | null;
  patient: { mrn: string; age: number; drg: string; admitDate: string; dischargeDate: string };
  triage: TriageOutput;
  initialRun: RunView | null;
  demoControls: boolean;
}

export function AccountDetail(props: AccountDetailProps) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(props.initialRun);
  const [statuses, setStatuses] = useState<Record<Stage, StageStatus>>(statusesFromRun(props.initialRun));
  const [liveElapsed, setLiveElapsed] = useState<Partial<Record<Stage, number>>>({});
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"pipeline" | "review">("pipeline");
  const [banner, setBanner] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [draftChars, setDraftChars] = useState(0);
  const [draftPreview, setDraftPreview] = useState("");
  const [expanded, setExpanded] = useState<Record<Stage, boolean>>(ALL_COLLAPSED);
  // True only for a run this page started, which is what gates every automatic
  // behaviour below. A cached run never moves the page on its own.
  const [liveRun, setLiveRun] = useState(false);
  const [autoJumpArmed, setAutoJumpArmed] = useState(false);
  const [justJumped, setJustJumped] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Refs, not state: these change on every mouse move and nothing renders from
  // them, so writing here costs nothing and never triggers a render.
  const tabRef = useRef<"pipeline" | "review">("pipeline");
  const lastActivityRef = useRef(Date.now());

  // router.refresh() re-renders the server component but leaves this client
  // component's state alone, so without this the run started above would never
  // reach the panel: `run` would sit at null and the review tab stay locked.
  const [syncedRunId, setSyncedRunId] = useState<string | null>(props.initialRun?.id ?? null);
  const incomingRunId = props.initialRun?.id ?? null;
  if (!running && incomingRunId !== syncedRunId) {
    setSyncedRunId(incomingRunId);
    setRun(props.initialRun);
    setStatuses(statusesFromRun(props.initialRun));
  }

  const toggleStage = useCallback((stage: Stage) => {
    setExpanded((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }, []);

  const runLive = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setLiveRun(true);
    setBanner(null);
    setRun(null);
    setDraftChars(0);
    setDraftPreview("");
    setLiveElapsed({});
    setStatuses(IDLE);
    setExpanded(ALL_COLLAPSED);
    tabRef.current = "pipeline";
    setTab("pipeline");
    setAutoJumpArmed(false);
    setResetArmed(false);

    try {
      const response = await fetch(`/api/pipeline/${props.denialId}`, {
        method: "POST",
        signal: controller.signal,
      });
      if (response.status === 429) {
        // The rate cap sends a message written for the person reading it.
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Live runs are rate limited. Try again shortly, or use Show cached.");
      }
      if (!response.ok || !response.body) throw new Error(`Pipeline request failed: HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as StageEvent;

          if (event.type === "stage_started") {
            setStatuses((prev) => ({ ...prev, [event.stage]: "running" }));
            // Opening this stage closes the previous one. The presenter follows
            // the pipeline without clicking; any card reopens on click.
            setExpanded(onlyExpanded(event.stage));
          } else if (event.type === "stage_completed") {
            setStatuses((prev) => ({ ...prev, [event.stage]: event.skipped ? "skipped" : "done" }));
            setLiveElapsed((prev) => ({ ...prev, [event.stage]: event.ms }));
          } else if (event.type === "draft_token") {
            setDraftChars((n) => n + event.text.length);
            setDraftPreview((prev) => (prev + event.text).slice(-DRAFT_PREVIEW_CHARS));
          } else if (event.type === "run_completed") {
            setAutoJumpArmed(true);
            lastActivityRef.current = Date.now();
            setResetArmed(true);
          } else if (event.type === "run_failed") {
            setBanner({ tone: "error", text: `Run failed during ${event.stage ?? "setup"}: ${event.error}` });
          }
        }
      }
      // Reload from the database so the panel shows the persisted run.
      router.refresh();
      setBanner({ tone: "info", text: "Run complete. Reloading the persisted run." });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setBanner({ tone: "error", text: (error as Error).message });
    } finally {
      setRunning(false);
    }
  }, [props.denialId, router]);

  const showCached = useCallback(() => {
    setBanner(null);
    setLiveRun(false);
    setAutoJumpArmed(false);
    setRun(props.initialRun);
    setStatuses(statusesFromRun(props.initialRun));
    setLiveElapsed({});
    // A cached run opens collapsed with its summaries showing.
    setExpanded(ALL_COLLAPSED);
    if (!props.initialRun) setBanner({ tone: "info", text: "No completed run for this case yet. Run it live." });
  }, [props.initialRun]);

  const resetCase = useCallback(async () => {
    const response = await fetch(`/api/demo/reset/${props.denialId}`, { method: "POST" });
    const body = (await response.json()) as { error?: string; runsDeleted?: number };
    if (!response.ok) {
      setBanner({ tone: "error", text: body.error ?? "Reset failed." });
      return;
    }
    setRun(null);
    setStatuses(IDLE);
    setLiveElapsed({});
    setExpanded(ALL_COLLAPSED);
    tabRef.current = "pipeline";
    setTab("pipeline");
    setLiveRun(false);
    setResetArmed(false);
    setBanner({ tone: "info", text: `Reset: ${body.runsDeleted} run(s) deleted.` });
    router.refresh();
  }, [props.denialId, router]);

  const reviewReady = run !== null && run.route !== null && run.route !== "do_not_appeal";

  const silentReset = useCallback(async () => {
    // Deliberately quiet: no banner. The case goes back to unrun so the next
    // rehearsal starts clean, which is the whole point of the timer.
    try {
      const response = await fetch(`/api/demo/reset/${props.denialId}`, { method: "POST" });
      if (!response.ok) return;
      setRun(null);
      setStatuses(IDLE);
      setLiveElapsed({});
      setExpanded(ALL_COLLAPSED);
      tabRef.current = "pipeline";
      setTab("pipeline");
      setLiveRun(false);
      router.refresh();
    } catch {
      // A failed auto-reset must never surface during a demo. The presenter
      // still has the Reset case control.
    } finally {
      setResetArmed(false);
    }
  }, [props.denialId, router]);

  /** Tab changes go through here so tabRef stays in step with the state. */
  const changeTab = useCallback((next: "pipeline" | "review") => {
    tabRef.current = next;
    setTab(next);
  }, []);

  // Once the run has landed in the database, hand the screen to the reviewer.
  // Waiting on `run` rather than on the completion event alone means the panel
  // always has something to render when it appears.
  useEffect(() => {
    if (!autoJumpArmed || !liveRun || !reviewReady) return;
    const timer = setTimeout(() => {
      changeTab("review");
      setAutoJumpArmed(false);
      setJustJumped(true);
    }, AUTO_REVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoJumpArmed, liveRun, reviewReady, changeTab]);

  // Let the arrival highlight fade on its own.
  useEffect(() => {
    if (!justJumped) return;
    const timer = setTimeout(() => setJustJumped(false), 1400);
    return () => clearTimeout(timer);
  }, [justJumped]);

  // Auto-reset. Only demo cases can be reset server-side, so do not arm the
  // timer anywhere else.
  const resettable = props.demoControls && props.split === "demo";

  // The timer measures idleness, not time since the run. Any mouse move, key
  // or scroll anywhere on the page counts as the presenter still working this
  // case, so a long stretch of questions never costs them the letter. It fires
  // only when the page has genuinely been left alone.
  useEffect(() => {
    if (!resettable || !resetArmed) return;

    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, bump, { passive: true });
    }

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current < AUTO_RESET_IDLE_MS) return;
      void silentReset();
    }, IDLE_CHECK_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, bump);
      clearInterval(interval);
    };
  }, [resettable, resetArmed, silentReset]);


  return (
    <div>
      <div className="sticky top-[50px] z-20 flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-[14px] py-[9px]">
        <Link
          href="/"
          className="flex h-[26px] items-center rounded-[5px] border border-zinc-300 bg-white px-[9px] text-[12px] text-zinc-700 hover:bg-zinc-50"
        >
          &larr; Workqueue
        </Link>
        <span className="font-mono text-[13px] font-semibold">{props.denialId}</span>
        <span className="h-[18px] w-px bg-zinc-300" />
        <span className="text-[12.5px] text-zinc-700">{props.payerName}</span>
        <span className="h-[18px] w-px bg-zinc-300" />
        <span className="text-[12.5px] text-zinc-700">{props.conditionLabel}</span>
        <span className="inline-flex h-[18px] items-center rounded border border-zinc-200 bg-zinc-100 px-[6px] font-mono text-[10px] font-semibold text-zinc-600">
          {CATEGORY_LABEL[props.category] ?? props.category}
        </span>
        <MockBadge label={`${props.split.toUpperCase()} SPLIT`} />
        <span className="flex-1" />
        <div className="text-right">
          <div className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">Denied</div>
          <div className="font-mono text-[13px] font-semibold">{formatDollars(props.amount)}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">Appeal window</div>
          <div
            className={cn(
              "font-mono text-[13px] font-semibold",
              props.triage.days_left <= 0 ? "text-red-700" : "text-amber-700",
            )}
          >
            {props.triage.days_left} days
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">EV</div>
          <div className="font-mono text-[13px] font-semibold text-green-700">
            {formatDollars(props.triage.expected_value)}
          </div>
        </div>
      </div>

      <div className="flex min-h-[760px] items-stretch">
        <CaseInputs
          letterText={props.letterText}
          carc={props.carc}
          rarc={props.rarc}
          chart={props.chart}
          criteriaStyle={props.criteriaStyle}
          payerName={props.payerName}
          payerNotes={props.payerNotes}
          appealFormatNotes={props.appealFormatNotes}
          highlightLabel={highlight}
        />

        <div className="w-[55%] bg-white p-3">
          <div className="mb-[10px] flex items-center gap-2">
            <div className="flex overflow-hidden rounded-[6px] border border-zinc-300">
              <button
                type="button"
                onClick={() => changeTab("pipeline")}
                className={cn(
                  "h-[28px] border-r border-zinc-300 px-3 text-[12px] font-medium",
                  tab === "pipeline" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50",
                )}
              >
                Pipeline
              </button>
              <button
                type="button"
                onClick={() => reviewReady && changeTab("review")}
                disabled={!reviewReady}
                title={reviewReady ? undefined : "Opens once a run completes with a draft."}
                className={cn(
                  "h-[28px] px-3 text-[12px] font-medium",
                  tab === "review" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50",
                  !reviewReady && "cursor-not-allowed text-zinc-400 hover:bg-white",
                )}
              >
                Review panel {reviewReady ? "" : "· locked"}
              </button>
            </div>
            <span className="flex-1" />
            <button
              type="button"
              onClick={runLive}
              disabled={running}
              className={cn(
                "h-[28px] rounded-[6px] border border-zinc-900 bg-zinc-900 px-[13px] text-[12px] font-semibold text-white",
                running && "cursor-not-allowed opacity-60",
              )}
            >
              {running ? "Running…" : "Run live"}
            </button>
            <button
              type="button"
              onClick={showCached}
              className="h-[28px] rounded-[6px] border border-zinc-300 bg-white px-[11px] text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Show cached
            </button>
            {props.demoControls ? (
              <button
                type="button"
                onClick={resetCase}
                className="h-[28px] rounded-[6px] border border-red-200 bg-white px-[9px] text-[11.5px] text-red-700 hover:bg-red-50"
              >
                Reset case
              </button>
            ) : null}
          </div>

          {banner ? (
            <div
              className={cn(
                "mb-[10px] rounded-[5px] border px-[9px] py-[6px] text-[11.5px]",
                banner.tone === "error"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-blue-200 bg-blue-50 text-blue-800",
              )}
            >
              {banner.text}
            </div>
          ) : null}

          {running && draftChars > 0 ? (
            <div className="mb-[10px] rounded-[5px] border border-zinc-200 bg-zinc-50 px-[9px] py-[6px] font-mono text-[11px] text-zinc-600">
              drafting… {draftChars.toLocaleString()} characters streamed
            </div>
          ) : null}

          {tab === "pipeline" ? (
            <StageCards
                run={run}
              statuses={statuses}
              liveElapsed={liveElapsed}
              thresholdCents={props.triage.threshold_cents}
              expanded={expanded}
              onToggle={toggleStage}
              draftPreview={draftPreview}
            />
          ) : (
            <div
              className={cn(
                "rounded-[8px] transition-shadow duration-700",
                justJumped && "shadow-[0_0_0_3px_rgba(59,130,246,0.35)]",
              )}
            >
              <ReviewPanel
              run={run}
                denialId={props.denialId}
                onCiteLine={setHighlight}
                highlight={highlight}
                onFeedbackSaved={() => router.refresh()}
                payerName={props.payerName}
                category={props.category}
                payerOverturnRate={props.payerOverturnRate}
              />
            </div>
          )}

          {run && tab === "pipeline" ? (
            <div className="mt-3 flex items-center gap-[10px] rounded-[6px] border border-zinc-200 bg-zinc-50 px-[10px] py-[8px]">
              <span className="text-[11px] text-zinc-500">Route</span>
              <RouteBadge route={run.route} />
              <span className="text-[11.5px] text-zinc-700">{run.routeReason}</span>
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-zinc-500">
                {formatSeconds(run.totalMs)} · {formatCost(run.totalCost)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
