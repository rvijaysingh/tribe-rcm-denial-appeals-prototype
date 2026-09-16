import { ROUTE_LABEL, ROUTE_STYLE } from "@/lib/ui/format";
import { cn } from "@/lib/utils";

/**
 * The route a run landed on. Also renders the not-yet-run state, so a
 * workqueue row never shows an empty cell where a route will go.
 */
export function RouteBadge({ route, className }: { route: string | null; className?: string }) {
  if (!route) {
    return <span className={cn("font-mono text-[11px] text-zinc-400", className)}>&mdash;</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex h-[19px] items-center rounded border px-[6px] font-mono text-[10px] font-semibold",
        ROUTE_STYLE[route] ?? ROUTE_STYLE.do_not_appeal,
        className,
      )}
    >
      {ROUTE_LABEL[route] ?? route}
    </span>
  );
}

/** Small caps label used for anything mocked on screen (PRD 6.1). */
export function MockBadge({ label = "MOCK", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-[3px] border border-amber-200 bg-yellow-50 px-[5px] font-mono text-[9.5px] font-semibold text-yellow-800",
        className,
      )}
    >
      {label}
    </span>
  );
}
