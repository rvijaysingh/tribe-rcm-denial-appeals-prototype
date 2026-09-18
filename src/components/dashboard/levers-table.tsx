import { MockBadge } from "@/components/route-badge";
import { PHASE_ONE_LEVERS, TARGETS_FOOTER, type MeasuredKey } from "@/lib/targets";

/**
 * The Phase 1 levers (PRD 2, PRD 6.4).
 *
 * Proposal figures, not measurements, so the panel says so in its header. The
 * one exception is the "Measured here" column, which carries a real number
 * where the prototype has one and a dash everywhere else; the dash is the
 * point, since most of these levers cannot be observed in a prototype at all.
 */

export type MeasuredLevers = Partial<Record<MeasuredKey, string>>;

export function LeversTable({ measured }: { measured: MeasuredLevers }) {
  return (
    <section>
      <div className="mb-[9px] flex items-center gap-[7px]">
        <span className="font-mono text-[11px] font-semibold tracking-wide text-zinc-600 uppercase">
          Phase 1 levers
        </span>
        <MockBadge label="FROM THE PROPOSAL, NOT MEASURED HERE" />
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-zinc-50 text-left font-mono text-[9.5px] tracking-wide text-zinc-500 uppercase">
              <th className="px-[10px] py-[7px] font-semibold">Lever</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">Today</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">2027</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">2028</th>
              <th className="px-[10px] py-[7px] text-right font-semibold">Measured here</th>
            </tr>
          </thead>
          <tbody>
            {PHASE_ONE_LEVERS.map((lever) => {
              const here = lever.measured ? measured[lever.measured] : undefined;
              return (
                <tr key={lever.label} className="border-t border-zinc-100 align-top">
                  <td className="px-[10px] py-[7px] font-medium text-zinc-800">
                    {lever.label}
                    {lever.note ? (
                      <div className="mt-[2px] text-[11px] font-normal text-zinc-500">{lever.note}</div>
                    ) : null}
                  </td>
                  <td className="px-[10px] py-[7px] text-right tabular-nums text-zinc-700">{lever.today}</td>
                  {lever.guardrail ? (
                    <td className="px-[10px] py-[7px] text-right text-zinc-400" colSpan={2}>
                      watched, not targeted
                    </td>
                  ) : (
                    <>
                      <td className="px-[10px] py-[7px] text-right tabular-nums text-zinc-800">{lever.target2027}</td>
                      <td className="px-[10px] py-[7px] text-right tabular-nums text-zinc-800">{lever.target2028}</td>
                    </>
                  )}
                  <td
                    className={`px-[10px] py-[7px] text-right tabular-nums ${
                      here ? "font-semibold text-green-700" : "text-zinc-300"
                    }`}
                  >
                    {here ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-[8px] text-[11px] text-zinc-500">
        {TARGETS_FOOTER} Nothing in the target columns is produced by this prototype, and no measured number was
        derived from them.
      </div>
    </section>
  );
}
