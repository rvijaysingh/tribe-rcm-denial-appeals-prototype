import { redirect } from "next/navigation";

/**
 * The dashboard moved to /dashboard/denials when it became the Claim Denial
 * Dashboard. Kept as a redirect so older links and any bookmark a panellist
 * made during a rehearsal still land somewhere useful.
 */
export default function MetricsRedirect(): never {
  redirect("/dashboard/denials");
}
