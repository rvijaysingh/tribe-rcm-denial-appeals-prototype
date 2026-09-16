/**
 * npm run db:seed
 *
 * Builds each seed pass's artifact, then loads everything into DATABASE_URL
 * in one transaction. Idempotent: rerunning with unchanged artifacts makes no
 * API calls (embeddings are cached) and leaves the database identical.
 *
 * Flags:
 *   --skip-load   build artifacts only, do not touch the database
 */

import "./load-env";
import { closeDb, db } from "../../src/lib/db/client";
import { writeArtifact } from "./artifacts";
import { embedDocumentsCached } from "./embed-cache";
import { loadAccounts, loadCriteria, seedAnchor, type LoadCounts } from "./load";
import { buildCriteria } from "./pass-a-criteria";
import { buildCaseSeeds } from "./pass-b-cases";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const skipLoad = args.has("--skip-load");
  const started = Date.now();

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

  if (skipLoad) {
    console.log("--skip-load: artifacts written, database untouched");
    return;
  }

  // ---- Embeddings
  const texts = [...criteria.clauses.map((c) => c.text), ...criteria.payerNotes.map((n) => n.text)];
  const embedded = await embedDocumentsCached(texts);
  const vectors = new Map(texts.map((t, i) => [t, embedded.vectors[i]]));
  console.log(
    `Embeddings: ${embedded.cacheHits} cached, ${embedded.cacheMisses} new` +
      (embedded.cacheMisses > 0
        ? ` (${embedded.apiTokens} tokens, $${embedded.costUsd.toFixed(5)})`
        : ""),
  );

  // ---- Load
  const counts: LoadCounts = await db.transaction(async (tx) => {
    const anchor = seedAnchor();
    return {
      ...(await loadCriteria(tx, criteria, vectors)),
      ...(await loadAccounts(tx, cases, anchor)),
    };
  });

  console.log("Loaded:");
  for (const [table, { upserted, removed }] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(18)} ${String(upserted).padStart(5)} upserted, ${removed} removed`);
  }
  console.log(`Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((error) => {
    console.error("db:seed failed:", error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
