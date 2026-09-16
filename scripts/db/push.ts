/**
 * npm run db:push
 *
 * Ensures pgvector exists, then applies the Drizzle schema to DATABASE_URL.
 *
 * drizzle-kit push diffs the schema directly and never reads the migration
 * files, so the hand-added CREATE EXTENSION in drizzle/0000_*.sql does not run
 * on this path. Without this step, pushing vector(1024) columns to a fresh
 * database fails with `type "vector" does not exist`.
 */

import { spawn } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function ensureVectorExtension(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local before running db:push.");
  }

  const sql = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const [row] = await sql<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `;
    if (!row) {
      throw new Error(
        "pgvector is still not present after CREATE EXTENSION. The database user " +
          "may lack permission to install extensions.",
      );
    }
    console.log(`pgvector ${row.extversion} ready`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function runDrizzlePush(): Promise<void> {
  return new Promise((resolve, reject) => {
    // --force auto-approves data-loss statements because npm scripts have no
    // TTY for the confirmation prompt. Safe here: all data comes from db:seed,
    // which is idempotent and regenerates everything.
    // shell: true so the drizzle-kit shim resolves on Windows.
    const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`drizzle-kit push exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  await ensureVectorExtension();
  await runDrizzlePush();
}

main().catch((error) => {
  console.error("db:push failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
