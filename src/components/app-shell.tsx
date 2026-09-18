import Link from "next/link";
import { MockBadge } from "./route-badge";
import { cn } from "@/lib/utils";

/**
 * Application chrome: client mark, product name, primary nav.
 *
 * The client's logo is loaded from NEXT_PUBLIC_CLIENT_LOGO_URL and falls back
 * to a generic wordmark (PRD 6.1). The client is never named in this repo, so
 * the fallback says what it is rather than pretending to be a brand.
 */

const NAV = [
  { href: "/", label: "Workqueue", match: (p: string) => p === "/" || p.startsWith("/accounts") },
  {
    href: "/dashboard/denials",
    label: "Claim Denial Dashboard",
    match: (p: string) => p === "/dashboard/denials" || p === "/dashboard/metrics",
  },
  { href: "/dashboard/evals", label: "Evals", match: (p: string) => p === "/dashboard/evals" },
];

function ClientMark() {
  const logoUrl = process.env.NEXT_PUBLIC_CLIENT_LOGO_URL;
  if (logoUrl) {
    // Intentionally a plain img: the URL is operator-supplied at deploy time
    // and next/image would need it whitelisted in next.config.
    //
    // A cap rather than a fixed height: the operator supplies the file, so let
    // a small mark render at its own size and only bring an oversized one down.
    // Width is auto so the aspect ratio survives whatever they upload.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="Client logo" className="max-h-12 w-auto" />;
  }
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-white">
        RCM
      </span>
      <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap">The RCM operator</span>
      <span className="rounded-[3px] border border-zinc-200 px-[3px] py-px font-mono text-[9px] text-zinc-400">
        FALLBACK
      </span>
    </span>
  );
}

export function AppShell({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen min-w-[1240px] max-w-[1440px] border-x border-zinc-200 bg-white">
      <header className="sticky top-0 z-30 flex h-[64px] items-center gap-[18px] border-b border-zinc-200 bg-white px-[14px]">
        <ClientMark />
        <span className="h-[22px] w-px bg-zinc-200" />
        <span className="text-[12.5px] whitespace-nowrap text-zinc-600">Clinical Appeals Engine</span>
        <nav className="ml-[14px] flex items-center gap-[2px]">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-[28px] items-center rounded-[5px] border px-[11px] text-[12.5px] font-medium",
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-transparent text-zinc-600 hover:bg-zinc-100",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="flex-1" />
        <MockBadge label="MOCK DATA" className="h-[19px] text-[10px]" />
      </header>
      {children}
    </div>
  );
}
