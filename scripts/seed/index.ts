/**
 * npm run db:seed
 *
 * Builds each seed pass's artifact, then loads everything into DATABASE_URL
 * in one transaction. Idempotent: rerunning with unchanged artifacts makes no
 * API calls (embeddings are cached, charts are committed) and leaves the
 * database identical.
 *
 * This script never calls the Anthropic API unless --generate is passed. If a
 * generated artifact is missing or stale, it stops and says which.
 *
 * Flags:
 *   --generate              generate missing or stale LLM artifacts (costs money)
 *   --regenerate=<ids|all>  force regeneration for these denial IDs; implies --generate
 *   --concurrency=<n>       parallel LLM calls, default 6
 *   --skip-load             build artifacts only, do not touch the database
 */

import "./load-env";
import { closeDb, getDb } from "../../src/lib/db/client";
import { parseSeedArgs } from "./args";
import { writeArtifact } from "./artifacts";
import { embedDocumentsCached } from "./embed-cache";
import {
  loadAccounts,
  loadCharts,
  loadCriteria,
  loadDenialsAndPrecedents,
  loadGroundTruth,
  seedAnchor,
  type LoadCounts,
} from "./load";
import { buildCriteria } from "./pass-a-criteria";
import { buildCaseSeeds } from "./pass-b-cases";
import { runPassC } from "./pass-c-charts";
import { runPassD } from "./pass-d-letters";
import { runPassE } from "./pass-e-truth";

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const started = Date.now();
  let llmCost = 0;

  // ---- Pass A
  const criteria = buildCriteria();
  const criteriaChanged = writeArtifact("criteria.json", criteria);
  console.log(
    `Pass A: ${criteria.criteriaSets.length} criteria sets, ${criteria.clauses.length} clauses ` +
      `(${criteria.clauses.filter((c) => c.required).length} required), ` +
      `${criteria.payerNotes.length} payer notes${criteriaChanged ? " [artifact updated]" : ""}`,
  );

  // ---- Pass B
  const casesArtifact = buildCaseSeeds(criteria);
  const { cases } = casesArtifact;
  const casesChanged = writeArtifact("cases.json", casesArtifact);
  const bySplit = (split: string) => cases.filter((c) => c.split === split).length;
  console.log(
    `Pass B: ${cases.length} case seeds (dev ${bySplit("dev")}, test ${bySplit("test")}, demo ${bySplit("demo")})` +
      (casesChanged ? " [artifact updated]" : ""),
  );

  // ---- Pass C
  const passC = await runPassC(cases, criteria, {
    generate: args.generate,
    regenerate: args.regenerate,
    concurrency: args.concurrency,
  });
  llmCost += passC.costUsd;
  const totalLines = [...passC.charts.values()].reduce(
    (n, c) => n + c.documents.reduce((m, d) => m + d.lines.length, 0),
    0,
  );
  console.log(
    `Pass C: ${passC.charts.size} charts, ${totalLines} lines` +
      (passC.generated.length > 0
        ? ` [generated ${passC.generated.length}, $${passC.costUsd.toFixed(2)}]`
        : ""),
  );

  // ---- Pass D
  const passD = await runPassD(cases, criteria, {
    generate: args.generate,
    regenerate: args.regenerate,
    concurrency: args.concurrency,
  });
  llmCost += passD.costUsd;
  console.log(
    `Pass D: ${passD.letters.size} denial letters, ${passD.precedents.length} precedents` +
      (passD.generated.length > 0
        ? ` [generated ${passD.generated.length}, ${passD.costUsd.toFixed(2)}]`
        : ""),
  );

  // ---- Pass E
  const passE = runPassE(cases, criteria);
  const truthChanged = writeArtifact("ground-truth.json", passE.artifact);
  const routeTally = (route: string) =>
    passE.artifact.cases.filter((c) => c.expectedRoute === route).length;
  console.log(
    `Pass E: ground truth for ${passE.artifact.cases.length} cases ` +
      `(ready ${routeTally("ready")}, needs_review ${routeTally("needs_review")}, ` +
      `needs_docs ${routeTally("needs_docs")}, do_not_appeal ${routeTally("do_not_appeal")})` +
      (truthChanged ? " [artifact updated]" : ""),
  );
  console.log(
    `  human spot checks: ${passE.spotChecked} of ${passE.spotCheckTotal} complete` +
      (passE.spotChecked < passE.spotCheckTotal
        ? " (see scripts/seed/data/spot-check-sheet.md)"
        : ""),
  );

  if (args.skipLoad) {
    console.log("--skip-load: artifacts written, database untouched");
    return;
  }

  // ---- Embeddings
  const texts = [
    ...criteria.clauses.map((c) => c.text),
    ...criteria.payerNotes.map((n) => n.text),
    ...passD.precedents.map((p) => p.summary),
  ];
  const embedded = await embedDocumentsCached(texts);
  const vectors = new Map(texts.map((t, i) => [t, embedded.vectors[i]]));
  console.log(
    `Embeddings: ${embedded.cacheHits} cached, ${embedded.cacheMisses} new` +
      (embedded.cacheMisses > 0
        ? ` (${embedded.apiTokens} tokens, $${embedded.costUsd.toFixed(5)})`
        : ""),
  );

  // ---- Load
  const counts: LoadCounts = await getDb().transaction(async (tx) => {
    const anchor = seedAnchor();
    return {
      ...(await loadCriteria(tx, criteria, vectors)),
      ...(await loadAccounts(tx, cases, anchor)),
      ...(await loadCharts(tx, cases, passC.charts)),
      ...(await loadDenialsAndPrecedents(tx, cases, criteria, passD.letters, passD.precedents, vectors, anchor)),
      ...(await loadGroundTruth(tx, passE.artifact.cases)),
    };
  });

  console.log("Loaded:");
  for (const [table, { upserted, removed }] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(18)} ${String(upserted).padStart(5)} upserted, ${removed} removed`);
  }
  console.log(
    `Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (llmCost > 0 ? `, LLM spend $${llmCost.toFixed(2)}` : ""),
  );
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed/index.ts")) {
  main()
    .catch((error) => {
      console.error("db:seed failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
