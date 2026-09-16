"use client";

import { useMemo, useState } from "react";
import { MockBadge } from "@/components/route-badge";
import type { ChartLineView } from "./types";
import { cn } from "@/lib/utils";

/**
 * The left column of the account detail screen: the messy inputs exactly as
 * received (PRD 6.2). Denial letter with its 835 codes, the chart as
 * line-numbered documents, and the payer's criteria set and unpublished notes.
 *
 * Chart lines carry their citation label as an anchor, so the review panel can
 * scroll a cited line into view and highlight it.
 */

const DOC_LABEL: Record<string, string> = {
  hp: "History and physical",
  progress: "Progress note",
  discharge: "Discharge summary",
};

function Panel({ title, chips, children }: { title: string; chips?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-[10px] rounded-[7px] border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center gap-[6px] border-b border-zinc-100 px-[10px] py-[8px]">
        <span className="mr-1 text-[12px] font-semibold">{title}</span>
        {chips}
      </div>
      {children}
    </div>
  );
}

function CodeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] border border-zinc-200 bg-zinc-100 px-[5px] py-px font-mono text-[10px] text-zinc-700">
      {children}
    </span>
  );
}

export function CaseInputs({
  letterText,
  carc,
  rarc,
  chart,
  criteriaStyle,
  payerName,
  payerNotes,
  appealFormatNotes,
  highlightLabel,
}: {
  letterText: string;
  carc: string;
  rarc: string;
  chart: ChartLineView[];
  criteriaStyle: string;
  payerName: string;
  payerNotes: { id: string; text: string }[];
  appealFormatNotes: string;
  highlightLabel: string | null;
}) {
  const docs = useMemo(() => {
    const groups: { docType: string; lines: ChartLineView[] }[] = [];
    for (const line of chart) {
      const last = groups[groups.length - 1];
      if (last && last.docType === line.docType && line.lineNo === last.lines[last.lines.length - 1].lineNo + 1) {
        last.lines.push(line);
      } else {
        groups.push({ docType: line.docType, lines: [line] });
      }
    }
    return groups;
  }, [chart]);

  const [activeDoc, setActiveDoc] = useState(0);

  // When a citation points into another document, follow it there.
  const highlightDoc = useMemo(() => {
    if (!highlightLabel) return null;
    return docs.findIndex((d) => d.lines.some((l) => l.label === highlightLabel));
  }, [docs, highlightLabel]);
  const shownDoc = highlightDoc !== null && highlightDoc >= 0 ? highlightDoc : activeDoc;

  return (
    <div className="w-[45%] border-r border-zinc-200 bg-zinc-50/40 p-3">
      <div className="mb-[9px] flex items-center gap-[7px]">
        <span className="font-mono text-[11px] font-semibold tracking-wide text-zinc-600 uppercase">
          Inputs as received
        </span>
        <MockBadge />
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <Panel
        title="Denial letter"
        chips={
          <>
            <CodeChip>835 GROUP CO</CodeChip>
            <CodeChip>CARC {carc.replace(/^CO-/, "")}</CodeChip>
            <CodeChip>RARC {rarc}</CodeChip>
          </>
        }
      >
        <pre className="max-h-[260px] overflow-auto px-[10px] py-[9px] font-mono text-[11px] leading-[1.6] whitespace-pre-wrap text-zinc-700">
          {letterText}
        </pre>
      </Panel>

      <Panel
        title="Chart excerpts"
        chips={
          <>
            {docs.map((doc, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveDoc(i)}
                className={cn(
                  "h-[22px] rounded-[4px] border px-[7px] text-[11px]",
                  i === shownDoc
                    ? "border-zinc-800 bg-zinc-800 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {DOC_LABEL[doc.docType] ?? doc.docType}
              </button>
            ))}
            <span className="ml-auto font-mono text-[10px] text-zinc-400">{chart.length} lines</span>
          </>
        }
      >
        <div data-chart-scroll className="max-h-[420px] overflow-auto px-[10px] py-[8px]">
          {docs[shownDoc]?.lines.map((line) => {
            const active = line.label === highlightLabel;
            return (
              <div
                key={line.label}
                data-line={line.label}
                className={cn(
                  "flex gap-[8px] rounded-[3px] px-[4px] py-[2px] font-mono text-[11px] leading-[1.65]",
                  active ? "bg-amber-100 ring-1 ring-amber-300" : "",
                )}
              >
                <span className="w-[34px] shrink-0 text-right text-zinc-400 select-none">{line.label}</span>
                <span className="text-zinc-700">{line.text}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Criteria set" chips={<CodeChip>{criteriaStyle.replace("_", "-")}</CodeChip>}>
        <div className="px-[10px] py-[9px]">
          <div className="text-[11.5px] text-zinc-600">
            {payerName} applies its {criteriaStyle.replace(/_/g, " ")} criteria to this condition. The clauses the
            pipeline retrieved are listed on the Retrieve stage.
          </div>
          <div className="mt-[9px] mb-[5px] font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
            Unpublished payer notes
          </div>
          <ul className="space-y-[5px]">
            {payerNotes.map((note) => (
              <li key={note.id} className="flex gap-[6px] text-[11.5px] leading-[1.5] text-zinc-700">
                <span className="font-mono text-[10px] text-zinc-400">{note.id}</span>
                <span>{note.text}</span>
              </li>
            ))}
            {payerNotes.length === 0 ? <li className="text-[11.5px] text-zinc-500">None recorded.</li> : null}
          </ul>
          <div className="mt-[9px] border-t border-zinc-100 pt-[7px] text-[11px] text-zinc-500">
            <span className="font-medium text-zinc-600">Appeal format: </span>
            {appealFormatNotes}
          </div>
        </div>
      </Panel>
    </div>
  );
}
