/**
 * Postgres connection and Drizzle client.
 *
 * The connection is created on first use, not at import. Importing a module
 * that happens to touch the database must not require DATABASE_URL: unit tests
 * import pipeline modules for their pure helpers and never open a connection.
 *
 * Next.js dev reloads modules on every edit, so the postgres.js pool is cached
 * on globalThis to avoid exhausting connections. Scripts call closeDb() when
 * they finish; the web app never does.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local for local development, " +
        "or to the Railway service variables in production.",
    );
  }
  return url;
}

declare global {
  var __denialAppealsSql: ReturnType<typeof postgres> | undefined;
  var __denialAppealsDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

/** The raw postgres.js client, for queries Drizzle cannot express. */
export function getSql(): ReturnType<typeof postgres> {
  if (!globalThis.__denialAppealsSql) {
    globalThis.__denialAppealsSql = postgres(connectionString(), {
      // Railway's Postgres plugin terminates idle connections; keep the pool small.
      max: process.env.NODE_ENV === "production" ? 10 : 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return globalThis.__denialAppealsSql;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!globalThis.__denialAppealsDb) {
    globalThis.__denialAppealsDb = drizzle(getSql(), { schema });
  }
  return globalThis.__denialAppealsDb;
}

export type Db = ReturnType<typeof getDb>;

/** Close the pool. Scripts must call this or the process will not exit. */
export async function closeDb(): Promise<void> {
  const sql = globalThis.__denialAppealsSql;
  globalThis.__denialAppealsSql = undefined;
  globalThis.__denialAppealsDb = undefined;
  if (sql) await sql.end({ timeout: 5 });
}

export { schema };
