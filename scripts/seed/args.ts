/**
 * Command-line flags for npm run db:seed. Kept apart from index.ts so tests can
 * import it without loading the database client.
 */

export interface SeedArgs {
  generate: boolean;
  regenerate: ReadonlySet<string> | "all";
  concurrency: number;
  skipLoad: boolean;
}

export function parseSeedArgs(argv: string[]): SeedArgs {
  const valueOf = (flag: string): string | undefined =>
    argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);

  const known = ["--generate", "--regenerate", "--concurrency", "--skip-load"];
  const unknown = argv.filter((a) => !known.includes(a.split("=")[0]));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);

  const regenerateRaw = valueOf("--regenerate");
  const regenerate: SeedArgs["regenerate"] =
    regenerateRaw === "all"
      ? "all"
      : new Set((regenerateRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  const concurrency = Number(valueOf("--concurrency") ?? 6);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error(`--concurrency must be an integer from 1 to 16`);
  }

  return {
    generate: argv.includes("--generate") || regenerateRaw !== undefined,
    regenerate,
    concurrency,
    skipLoad: argv.includes("--skip-load"),
  };
}
