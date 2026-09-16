"use client";

import { cn } from "@/lib/utils";
import type { Draft } from "@/lib/pipeline/draft-schema";
import type { RetrieveOutput } from "@/lib/pipeline/c-retrieve";
import type { VerifyResult } from "@/lib/pipeline/e-verify";

/**
 * Evidence matrix (PRD 6.3): one row per required clause, with how well the
 * draft argued it and which chart lines carry it.
 *
 * Status is derived, not stored:
 * - unsupported: the draft conceded it to unsupported_required, so the chart is
 *   silent on an element it needs.
 * - weak: argued, but the reviewer model flagged an assertion that cites it.
 * - supported: argued with nothing flagged.
 * - not argued: required, but no assertion cites it and the draft did not
 *   concede it. The PRD names three states; this fourth one is kept separate
 *   rather than folded into "weak" because it means something different and a
 *   nurse would act on it differently.
 */

export type ClauseStatus = "supported" | "weak" | "unsupported" | "not_argued";

const STATUS_STYLE: Record<ClauseStatus, string> = {
  supported: "text-green-700 bg-green-50 border-green-200",
  weak: "text-amber-700 bg-amber-50 border-amber-200",
  unsupported: "text-blue-700 bg-blue-50 border-blue-200",
  not_argued: "text-zinc-600 bg-zinc-100 border-zinc-200",
};

const STATUS_LABEL: Record<ClauseStatus, string> = {
  supported: "supported",
  weak: "weak",
  unsupported: "unsupported",
  not_argued: "not argued",
};

export interface ClauseRow {
  id: string;
  code: string;
  text: string;
  status: ClauseStatus;
  lines: string[];
  note: string | null;
}

export function buildMatrix(
  draft: Draft,
  retrieval: RetrieveOutput | null,
  verify: VerifyResult | null,
): ClauseRow[] {
  const required = (retrieval?.clauses ?? []).filter((c) => c.required);
  const conceded = new Map(draft.unsupported_required.map((g) => [g.clause_id, g.evidence_needed]));
  const flaggedText = new Set((verify?.judge?.flagged_assertions ?? []).map((f) => f.assertion_text.trim()));

  return required.map((clause) => {
    const citing = draft.sections
      .flatMap((s) => s.assertions)
      .filter((a) => a.clause_ids.includes(clause.id));
    const lines = [...new Set(citing.flatMap((a) => a.chart_line_ids))];
    const isFlagged = citing.some((a) => flaggedText.has(a.text.trim()));

    let status: ClauseStatus;
    let note: string | null = null;
    if (conceded.has(clause.id)) {
      status = "unsupported";
      note = conceded.get(clause.id) ?? null;
    } else if (citing.length === 0) {
      status = "not_argued";
      note = "No assertion cites this clause and the draft did not flag it as missing evidence.";
    } else if (isFlagged) {
      status = "weak";
      note = "The reviewer model flagged an assertion citing this clause.";
    } else {
      status = "supported";
    }
    return { id: clause.id, code: clause.code, text: clause.text, status, lines, note };
  });
}

export function EvidenceMatrix({
  rows,
  onCiteLine,
  highlight,
}: {
  rows: ClauseRow[];
  onCiteLine: (label: string) => void;
  highlight: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[7px] border border-zinc-200 bg-zinc-50 px-[10px] py-5 text-center text-[12px] text-zinc-500">
        No required clauses were retrieved for this case.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[7px] border border-zinc-200">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-zinc-50 text-left font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
            <th className="px-[9px] py-[6px] font-semibold">Clause</th>
            <th className="px-[9px] py-[6px] font-semibold">Requirement</th>
            <th className="px-[9px] py-[6px] font-semibold">Status</th>
            <th className="px-[9px] py-[6px] font-semibold">Supporting lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-zinc-100 align-top">
              <td className="px-[9px] py-[7px] whitespace-nowrap">
                <span className="font-mono text-[10.5px] text-zinc-400">{row.id}</span>{" "}
                <span className="font-mono text-[10.5px] text-zinc-700">{row.code}</span>
              </td>
              <td className="px-[9px] py-[7px] text-zinc-700">
                {row.text}
                {row.note ? <div className="mt-[3px] text-[11px] text-zinc-500">{row.note}</div> : null}
              </td>
              <td className="px-[9px] py-[7px]">
                <span
                  className={cn(
                    "inline-flex h-[18px] items-center rounded border px-[6px] font-mono text-[10px] font-semibold",
                    STATUS_STYLE[row.status],
                  )}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </td>
              <td className="px-[9px] py-[7px]">
                <span className="flex flex-wrap gap-[3px]">
                  {row.lines.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onCiteLine(label)}
                      className={cn(
                        "rounded-[3px] border px-[4px] font-mono text-[10px]",
                        highlight === label
                          ? "border-amber-300 bg-amber-100 text-amber-900"
                          : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  {row.lines.length === 0 ? <span className="text-zinc-400">&mdash;</span> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
