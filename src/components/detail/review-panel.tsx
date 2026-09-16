"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RouteBadge } from "@/components/route-badge";
import { SECTION_NAMES, type SectionName } from "@/lib/domain";
import { PAYER_HISTORY_WARN_THRESHOLD } from "@/lib/economics";
import { CATEGORY_LABEL, formatCost, formatPercent, formatSeconds } from "@/lib/ui/format";
import { cn } from "@/lib/utils";
import { EvidenceMatrix, buildMatrix } from "./evidence-matrix";
import {
  STAGE_META,
  STAGE_ORDER,
  classifyOutput,
  draftOutput,
  retrieveOutput,
  verifyOutput,
  type RunView,
} from "./types";

/**
 * Review panel (PRD 6.3). Three tabs over a completed run, plus the actions
 * that record what the reviewer did.
 *
 * The Draft tab renders from the draft JSON rather than parsing the rendered
 * letter, so each assertion keeps its own citations and a chip can highlight
 * the exact chart line or clause it points at.
 *
 * Reviewer minutes are measured from the moment this panel opens to the moment
 * an action is taken, which is what the metrics dashboard reports.
 */

const SECTION_HEADING: Record<SectionName, string> = {
  intro: "INTRODUCTION",
  clinical_summary: "CLINICAL SUMMARY",
  criteria_argument: "CRITERIA ARGUMENT",
  precedent: "PRECEDENT",
  request: "REQUEST",
};

const ESCALATION_REASONS = [
  "Needs a physician attestation",
  "Clinical judgement call beyond nurse review",
  "Payer requires peer to peer",
  "Chart contradicts the assertion",
];

export function ReviewPanel({
  run,
  denialId,
  onCiteLine,
  highlight,
  onFeedbackSaved,
  payerName,
  category,
  payerOverturnRate,
}: {
  run: RunView | null;
  denialId: string;
  onCiteLine: (label: string | null) => void;
  highlight: string | null;
  onFeedbackSaved: () => void;
  payerName: string;
  category: string;
  payerOverturnRate: number | null;
}) {
  const [tab, setTab] = useState<"draft" | "evidence" | "log">("draft");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [reason, setReason] = useState(ESCALATION_REASONS[0]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when the panel mounts for a run, not during render: reading the clock
  // while rendering is impure and React may render more than once.
  const openedAt = useRef<number | null>(null);
  // One node per rendered assertion, keyed by its trimmed text, so a flag can
  // scroll to the sentence it is about.
  const assertionNodes = useRef(new Map<string, HTMLParagraphElement | null>());
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  const draft = draftOutput(run);
  const retrieval = retrieveOutput(run);
  const verify = verifyOutput(run);
  const classify = classifyOutput(run);

  useEffect(() => {
    openedAt.current = Date.now();
  }, [run?.id]);

  useEffect(() => {
    if (!jumpTarget) return;
    const timer = setTimeout(() => setJumpTarget(null), 2000);
    return () => clearTimeout(timer);
  }, [jumpTarget]);

  const matrix = useMemo(
    () => (draft ? buildMatrix(draft.draft, retrieval, verify) : []),
    [draft, retrieval, verify],
  );

  const flags = useMemo(() => verify?.judge?.flagged_assertions ?? [], [verify]);
  const flaggedText = useMemo(() => new Set(flags.map((f) => f.assertion_text.trim())), [flags]);

  /** Scroll a flagged sentence into view in the Draft tab and flash it. */
  const jumpToAssertion = (text: string) => {
    const key = text.trim();
    setTab("draft");
    setEditing(false);
    setJumpTarget(key);
    // The Draft tab may have just been mounted by setTab, so wait a frame.
    requestAnimationFrame(() => {
      assertionNodes.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  /**
   * Open the editor on the first flagged sentence: select it in the textarea so
   * the reviewer lands on the problem instead of hunting for it.
   */
  const openEditor = () => {
    // Defined above the null guard below, so it checks for itself.
    if (!draft) return;
    setEditText(draft.letterText);
    setEditing(true);
    setTab("draft");
    const first = flags[0]?.assertion_text.trim();
    if (!first) return;
    requestAnimationFrame(() => {
      const node = editRef.current;
      if (!node) return;
      const at = node.value.indexOf(first);
      node.focus();
      if (at < 0) return;
      node.setSelectionRange(at, at + first.length);
      // Selecting alone does not scroll, so put the caret line near the middle.
      const ratio = at / Math.max(1, node.value.length);
      node.scrollTop = Math.max(0, ratio * node.scrollHeight - node.clientHeight / 2);
    });
  };

  if (!run || !draft) {
    return (
      <div className="rounded-[7px] border border-zinc-200 bg-zinc-50 px-[10px] py-6 text-center text-[12px] text-zinc-500">
        No draft for this case. Run the pipeline to produce one.
      </div>
    );
  }

  const send = async (action: "approve" | "edit" | "escalate") => {
    setBusy(true);
    setError(null);
    try {
      const reviewerMinutes = Math.max(0, (Date.now() - (openedAt.current ?? Date.now())) / 60000);
      const response = await fetch(`/api/feedback/${run.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewerMinutes: Number(reviewerMinutes.toFixed(2)),
          editedText: action === "edit" ? editText : undefined,
          reason: action === "escalate" ? reason : undefined,
        }),
      });
      const body = (await response.json()) as { error?: string; diff?: { addedCount: number; removedCount: number } };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

      setSaved(
        action === "edit" && body.diff
          ? `Edit saved. ${body.diff.addedCount} line(s) added, ${body.diff.removedCount} removed, ${reviewerMinutes.toFixed(1)} reviewer minutes.`
          : `${action === "approve" ? "Approved" : "Escalated"}. ${reviewerMinutes.toFixed(1)} reviewer minutes recorded.`,
      );
      setEditing(false);
      setEscalating(false);
      onFeedbackSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-[10px] flex items-center gap-[10px] rounded-[6px] border border-zinc-200 bg-zinc-50 px-[10px] py-[7px]">
        <RouteBadge route={run.route} />
        <span
          className="text-[11.5px] text-zinc-700"
          title="Ready: quick read and approve. Needs review: close read. Needs docs: a required criterion has no chart support. Do not appeal: triage stopped it."
        >
          {run.routeReason}
        </span>
        <span className="flex-1" />
        {classify ? (
          <span className="font-mono text-[10.5px] text-zinc-500">
            confidence {Math.min(classify.confidence, draft.draft.draft_confidence, verify?.judge?.overall ?? 1).toFixed(2)}
          </span>
        ) : null}
      </div>

      {flags.length > 0 ? (
        <div className="mb-[10px] overflow-hidden rounded-[6px] border border-amber-300 bg-amber-50">
          <div className="flex items-center gap-[8px] border-b border-amber-200 bg-amber-100/70 px-[10px] py-[6px]">
            <span className="text-[12px] text-amber-800">&#9888;</span>
            <span className="text-[11.5px] font-semibold text-amber-900">
              The reviewer model flagged {flags.length} assertion{flags.length === 1 ? "" : "s"}
            </span>
            <span className="flex-1" />
            <span className="text-[11px] text-amber-800">Read these before approving.</span>
          </div>
          <div className="divide-y divide-amber-200">
            {flags.map((flag, i) => (
              <div key={i} className="px-[10px] py-[8px]">
                <div className="border-l-2 border-amber-400 pl-[8px] text-[11.5px] leading-[1.6] font-medium text-amber-950">
                  &ldquo;{flag.assertion_text}&rdquo;
                </div>
                <div className="mt-[4px] pl-[10px] text-[11.5px] leading-[1.55] text-amber-900">{flag.reason}</div>
                <button
                  type="button"
                  onClick={() => jumpToAssertion(flag.assertion_text)}
                  className="mt-[5px] ml-[10px] rounded-[4px] border border-amber-300 bg-white px-[7px] py-[2px] text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                >
                  Jump to assertion
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {payerOverturnRate !== null && payerOverturnRate < PAYER_HISTORY_WARN_THRESHOLD ? (
        <div className="mb-[10px] flex items-start gap-[8px] rounded-[6px] border border-amber-200 bg-amber-50 px-[10px] py-[7px]">
          <span className="text-[12px] leading-[1.3] text-amber-700">&#9888;</span>
          <div className="text-[11.5px] leading-[1.5] text-amber-900">
            <span className="font-semibold">Payer history.</span> {payerName} has overturned{" "}
            <span className="font-mono">{formatPercent(payerOverturnRate)}</span> of{" "}
            {CATEGORY_LABEL[category]?.toLowerCase() ?? category} appeals in the precedent store, below the{" "}
            <span className="font-mono">{formatPercent(PAYER_HISTORY_WARN_THRESHOLD)}</span> mark. A strong letter here
            still loses more often than it wins, so weigh the reviewer time against the odds.
          </div>
        </div>
      ) : null}

      <div className="mb-[10px] flex items-center gap-[2px]">
        {(["draft", "evidence", "log"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "h-[26px] rounded-[5px] px-[10px] text-[12px] font-medium",
              tab === key ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-50",
            )}
          >
            {key === "draft" ? "Draft" : key === "evidence" ? "Evidence" : "Run log"}
          </button>
        ))}
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-zinc-400">{denialId}</span>
      </div>

      {saved ? (
        <div className="mb-[10px] rounded-[5px] border border-green-200 bg-green-50 px-[9px] py-[6px] text-[11.5px] text-green-800">
          {saved}
        </div>
      ) : null}
      {error ? (
        <div className="mb-[10px] rounded-[5px] border border-red-200 bg-red-50 px-[9px] py-[6px] text-[11.5px] text-red-800">
          {error}
        </div>
      ) : null}

      {tab === "draft" ? (
        editing ? (
          <div className="rounded-[7px] border border-zinc-200 bg-white p-[10px]">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="h-[460px] w-full resize-none rounded-[5px] border border-zinc-300 p-[9px] font-mono text-[11.5px] leading-[1.7] text-zinc-800 outline-none focus:border-zinc-500"
            />
            <div className="mt-[8px] flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => send("edit")}
                className="h-[28px] rounded-[6px] border border-zinc-900 bg-zinc-900 px-[13px] text-[12px] font-semibold text-white disabled:opacity-60"
              >
                Save edit
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-[28px] rounded-[6px] border border-zinc-300 bg-white px-[11px] text-[12px] text-zinc-700"
              >
                Cancel
              </button>
              <span className="text-[11px] text-zinc-500">The diff is stored against the letter the run produced.</span>
            </div>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-[7px] border border-zinc-200 bg-white px-[12px] py-[10px]">
            {SECTION_NAMES.map((name) => {
              const assertions = draft.draft.sections
                .filter((s) => s.name === name)
                .flatMap((s) => s.assertions)
                .filter((a) => a.text.trim());
              if (assertions.length === 0) return null;
              return (
                <div key={name} className="mb-[14px]">
                  <div className="mb-[5px] font-mono text-[9.5px] font-semibold tracking-wide text-zinc-500">
                    {SECTION_HEADING[name]}
                  </div>
                  {assertions.map((assertion, i) => {
                    const key = assertion.text.trim();
                    const isFlagged = flaggedText.has(key);
                    const isJumpTarget = jumpTarget === key;
                    return (
                      <p
                        key={i}
                        ref={(node) => {
                          assertionNodes.current.set(key, node);
                        }}
                        className={cn(
                          "mb-[8px] scroll-mt-[60px] text-[12px] leading-[1.7] text-zinc-800 transition-shadow duration-500",
                          isFlagged && "rounded-[4px] border-l-2 border-amber-400 bg-amber-50 py-[5px] pr-[6px] pl-[8px]",
                          isJumpTarget && "shadow-[0_0_0_3px_rgba(245,158,11,0.45)]",
                        )}
                      >
                        {isFlagged ? (
                          <span
                            title="The reviewer model flagged this assertion"
                            className="mr-[5px] align-baseline text-[11px] text-amber-700"
                          >
                            &#9888;
                          </span>
                        ) : null}
                        {assertion.text}{" "}
                        {[...assertion.chart_line_ids, ...assertion.clause_ids].map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onCiteLine(id.startsWith("L") ? id : null)}
                            title={id.startsWith("L") ? "Highlight this chart line" : "Criteria clause"}
                            className={cn(
                              "mr-[2px] rounded-[3px] border px-[3px] align-baseline font-mono text-[9.5px]",
                              highlight === id
                                ? "border-amber-300 bg-amber-100 text-amber-900"
                                : id.startsWith("L")
                                  ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                  : "border-violet-200 bg-violet-50 text-violet-700",
                            )}
                          >
                            {id}
                          </button>
                        ))}
                      </p>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )
      ) : tab === "evidence" ? (
        <EvidenceMatrix rows={matrix} onCiteLine={onCiteLine} highlight={highlight} />
      ) : (
        <div className="overflow-hidden rounded-[7px] border border-zinc-200">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="bg-zinc-50 text-left font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
                <th className="px-[9px] py-[6px] font-semibold">Stage</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Latency</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Tokens in</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Tokens out</th>
                <th className="px-[9px] py-[6px] text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.map((stage) => {
                const row = run.stages.find((s) => s.stage === stage);
                const meta = STAGE_META[stage];
                return (
                  <tr key={stage} className={cn("border-t border-zinc-100", row?.skipped && "text-zinc-400")}>
                    <td className="px-[9px] py-[6px]">
                      <span className="font-mono text-[10.5px] text-zinc-500">{meta.letter}</span>{" "}
                      <span className="text-zinc-700">{meta.title}</span>
                      {row?.skipped ? <span className="ml-2 font-mono text-[10px]">skipped</span> : null}
                    </td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{formatSeconds(row?.ms)}</td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{row?.tokensIn ?? 0}</td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{row?.tokensOut ?? 0}</td>
                    <td className="px-[9px] py-[6px] text-right tabular-nums">{formatCost(row?.cost)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-zinc-200 bg-zinc-50 font-medium">
                <td className="px-[9px] py-[6px]">Total</td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">{formatSeconds(run.totalMs)}</td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">
                  {run.stages.reduce((n, s) => n + s.tokensIn, 0)}
                </td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">
                  {run.stages.reduce((n, s) => n + s.tokensOut, 0)}
                </td>
                <td className="px-[9px] py-[6px] text-right tabular-nums">{formatCost(run.totalCost)}</td>
              </tr>
            </tbody>
          </table>
          <div className="border-t border-zinc-200 bg-zinc-50 px-[9px] py-[6px] font-mono text-[10.5px] text-zinc-500">
            {run.modelSet} · {run.promptVersion}
          </div>
        </div>
      )}

      {!editing ? (
        <div className="mt-[10px] flex items-center gap-2 border-t border-zinc-200 pt-[10px]">
          <button
            type="button"
            disabled={busy}
            onClick={() => send("approve")}
            className="h-[30px] rounded-[6px] border border-green-700 bg-green-700 px-[14px] text-[12px] font-semibold text-white disabled:opacity-60"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={openEditor}
            className="h-[30px] rounded-[6px] border border-zinc-300 bg-white px-[12px] text-[12px] font-medium text-zinc-700"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEscalating((v) => !v)}
            className="h-[30px] rounded-[6px] border border-amber-300 bg-white px-[12px] text-[12px] font-medium text-amber-800"
          >
            Escalate to physician
          </button>
          {escalating ? (
            <>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-[30px] rounded-[6px] border border-zinc-300 bg-white px-[8px] text-[12px] text-zinc-700"
              >
                {ESCALATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => send("escalate")}
                className="h-[30px] rounded-[6px] border border-amber-700 bg-amber-700 px-[12px] text-[12px] font-semibold text-white disabled:opacity-60"
              >
                Confirm
              </button>
            </>
          ) : null}
          <span className="flex-1" />
          <span className="text-[11px] text-zinc-500">Nothing here submits to a payer.</span>
        </div>
      ) : null}
    </div>
  );
}
