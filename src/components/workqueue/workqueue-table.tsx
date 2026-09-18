"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MockBadge, RouteBadge } from "@/components/route-badge";
import { MANUAL_BREAKEVEN_DISPLAY, OLD_CAPACITY_CUTOFF } from "@/lib/economics";
import { CATEGORY_LABEL, formatCost, formatDollars, formatSeconds } from "@/lib/ui/format";
import { cn } from "@/lib/utils";

export interface WorkqueueItem {
  denialId: string;
  accountId: string;
  payerName: string;
  conditionLabel: string;
  category: string;
  amount: string;
  amountCents: number;
  daysLeft: number;
  triageDecision: "appeal" | "do_not_appeal";
  triageReason: string;
  expectedValue: number;
  wouldHaveBeenWorkedOld: boolean;
  route: string | null;
  runStatus: string | null;
  totalCost: string | null;
  totalMs: number | null;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[132px] rounded-md border border-zinc-200 bg-zinc-50/60 px-[11px] py-[7px]">
      <div className="font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="mt-[2px] text-[17px] font-semibold tracking-tight tabular-nums">{value}</div>
      {sub ? <div className="text-[10.5px] text-zinc-500">{sub}</div> : null}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[26px] items-center gap-[5px] rounded-[5px] border px-[9px] text-[11.5px]",
        active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-50",
      )}
    >
      {label}
      {count === undefined ? null : (
        <span className={cn("font-mono text-[10px]", active ? "text-zinc-300" : "text-zinc-400")}>{count}</span>
      )}
    </button>
  );
}

const ROUTES = ["ready", "needs_review", "needs_docs", "do_not_appeal"] as const;

export function WorkqueueTable({ items }: { items: WorkqueueItem[] }) {
  const [routeFilter, setRouteFilter] = useState<string[]>([]);
  const [payerFilter, setPayerFilter] = useState<string[]>([]);

  const payers = useMemo(() => [...new Set(items.map((i) => i.payerName))].sort(), [items]);

  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const route of ROUTES) {
      counts[route] = items.filter(
        (i) => (i.route ?? (i.triageDecision === "do_not_appeal" ? "do_not_appeal" : null)) === route,
      ).length;
    }
    return counts;
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const effectiveRoute = item.route ?? (item.triageDecision === "do_not_appeal" ? "do_not_appeal" : null);
        const routeOk = routeFilter.length === 0 || (effectiveRoute !== null && routeFilter.includes(effectiveRoute));
        const payerOk = payerFilter.length === 0 || payerFilter.includes(item.payerName);
        return routeOk && payerOk;
      }),
    [items, routeFilter, payerFilter],
  );

  const toggle = (list: string[], set: (next: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const totals = useMemo(() => {
    const denied = filtered.reduce((sum, i) => sum + i.amountCents, 0);
    const ev = filtered.reduce((sum, i) => sum + (i.triageDecision === "appeal" ? i.expectedValue : 0), 0);
    const cost = filtered.reduce((sum, i) => sum + Number(i.totalCost ?? 0), 0);
    const notWorkedBefore = filtered.filter((i) => i.triageDecision === "appeal" && !i.wouldHaveBeenWorkedOld).length;
    return { denied, ev, cost, notWorkedBefore };
  }, [filtered]);

  return (
    <div className="px-[14px] pt-[14px] pb-10">
      <div className="mb-3 flex items-end gap-[10px]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="m-0 text-[17px] font-semibold tracking-tight">Mock Workqueue</h1>
            <MockBadge />
          </div>
          <div className="mt-[3px] text-[11.5px] text-zinc-500">
            Denied inpatient accounts, synthetic dataset, no PHI
          </div>
        </div>
        <div className="flex-1" />
        <StatTile label="Accounts" value={String(filtered.length)} sub={`${items.length} in dataset`} />
        <StatTile label="Denied amount" value={formatDollars(totals.denied / 100)} />
        <StatTile
          label="Expected value"
          value={formatDollars(totals.ev)}
          sub={`${totals.notWorkedBefore} unworked under old cutoff`}
        />
        <StatTile label="Pipeline cost" value={formatCost(totals.cost)} />
      </div>

      <div className="mb-[10px] flex flex-wrap items-center gap-[6px]">
        <span className="mr-1 font-mono text-[9.5px] tracking-wide text-zinc-400 uppercase">Route</span>
        {ROUTES.map((route) => (
          <Chip
            key={route}
            label={route.replace(/_/g, " ")}
            count={routeCounts[route]}
            active={routeFilter.includes(route)}
            onClick={() => toggle(routeFilter, setRouteFilter, route)}
          />
        ))}
        <span className="mx-2 h-[18px] w-px bg-zinc-200" />
        <span className="mr-1 font-mono text-[9.5px] tracking-wide text-zinc-400 uppercase">Payer</span>
        {payers.map((payer) => (
          <Chip
            key={payer}
            label={payer}
            active={payerFilter.includes(payer)}
            onClick={() => toggle(payerFilter, setPayerFilter, payer)}
          />
        ))}
        {routeFilter.length > 0 || payerFilter.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setRouteFilter([]);
              setPayerFilter([]);
            }}
            className="ml-1 h-[26px] rounded-[5px] px-[8px] text-[11.5px] text-zinc-500 underline-offset-2 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-zinc-50 text-left font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
              <th className="px-[10px] py-[7px] font-semibold">Account</th>
              <th className="px-[10px] py-[7px] font-semibold">Payer</th>
              <th className="px-[10px] py-[7px] font-semibold">Condition</th>
              <th className="px-[10px] py-[7px] font-semibold">Denial category</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">Amount</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">Days left</th>
              <th className="px-[10px] py-[7px] font-semibold">Triage</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">Expected value</th>
              <th className="px-[10px] py-[7px] font-semibold">Pipeline</th>
              <th className="px-[10px] py-[7px] font-semibold">Route</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const dna = item.triageDecision === "do_not_appeal";
              return (
                <tr
                  key={item.denialId}
                  className={cn("border-t border-zinc-100 hover:bg-zinc-50", dna && "opacity-60")}
                >
                  <td className="px-[10px] py-[7px]">
                    <Link
                      href={`/accounts/${item.denialId}`}
                      className="font-mono text-[11.5px] font-medium text-blue-700 hover:underline"
                    >
                      {item.denialId}
                    </Link>
                  </td>
                  <td className="px-[10px] py-[7px] text-zinc-700">{item.payerName}</td>
                  <td className="px-[10px] py-[7px] text-zinc-700">{item.conditionLabel}</td>
                  <td className="px-[10px] py-[7px] text-zinc-600">{CATEGORY_LABEL[item.category] ?? item.category}</td>
                  <td className="px-[10px] py-[7px] text-right tabular-nums">{formatDollars(item.amount)}</td>
                  <td
                    className={cn(
                      "px-[10px] py-[7px] text-right tabular-nums",
                      item.daysLeft <= 0 ? "font-medium text-red-700" : item.daysLeft < 30 ? "text-amber-700" : "",
                    )}
                  >
                    {item.daysLeft}
                  </td>
                  <td className="px-[10px] py-[7px]" title={item.triageReason}>
                    {dna ? (
                      <span className="font-mono text-[10px] text-zinc-500">do not appeal</span>
                    ) : (
                      <span className="font-mono text-[10px] text-zinc-700">appeal</span>
                    )}
                  </td>
                  <td className="px-[10px] py-[7px] text-right tabular-nums">
                    {dna ? <span className="text-zinc-400">&mdash;</span> : formatDollars(item.expectedValue)}
                    {!dna && !item.wouldHaveBeenWorkedOld ? (
                      <span
                        className="ml-[6px] inline-flex h-[16px] items-center rounded-[3px] border border-violet-200 bg-violet-50 px-[4px] font-mono text-[9px] font-semibold text-violet-700"
                        title={`Below the old ${formatDollars(OLD_CAPACITY_CUTOFF)} capacity cutoff, though above the ${formatDollars(MANUAL_BREAKEVEN_DISPLAY)} manual breakeven: economic to work, and nobody worked it under the previous process.`}
                      >
                        NEW
                      </span>
                    ) : null}
                  </td>
                  <td className="px-[10px] py-[7px]">
                    {dna ? (
                      <span className="text-[11px] text-zinc-400">not run</span>
                    ) : item.runStatus === "completed" ? (
                      <span className="text-[11px] text-zinc-600">{formatSeconds(item.totalMs)}</span>
                    ) : item.runStatus === "failed" ? (
                      <span className="text-[11px] text-red-700">failed</span>
                    ) : item.runStatus === "running" ? (
                      <span className="text-[11px] text-blue-700">running</span>
                    ) : (
                      <span className="text-[11px] text-zinc-400">not run</span>
                    )}
                  </td>
                  <td className="px-[10px] py-[7px]">
                    <RouteBadge route={item.route ?? (dna ? "do_not_appeal" : null)} />
                  </td>
                  <td className="px-[10px] py-[7px] text-right tabular-nums text-zinc-600">
                    {dna && !item.totalCost ? "$0.00" : formatCost(item.totalCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="px-[10px] py-6 text-center text-[12px] text-zinc-500">
            No accounts match these filters.
          </div>
        ) : null}
      </div>

      <div className="mt-[8px] flex items-center gap-3 text-[11px] text-zinc-500">
        <span>Sorted by expected value, descending.</span>
        <span>
          Rows triaged do not appeal cost $0.00 and zero reviewer minutes: the pipeline never runs on them.
        </span>
      </div>
    </div>
  );
}
