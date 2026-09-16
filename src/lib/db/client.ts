/**
 * Postgres connection and Drizzle client.
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
}

function createSql() {
  return postgres(connectionString(), {
    // Railway's Postgres plugin terminates idle connections; keep the pool small.
    max: process.env.NODE_ENV === "production" ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 15,
  });
}

export const sql = globalThis.__denialAppealsSql ?? createSql();
if (process.env.NODE_ENV !== "production") {
  globalThis.__denialAppealsSql = sql;
}

export const db = drizzle(sql, { schema });

export type Db = typeof db;

/** Close the pool. Scripts must call this or the process will not exit. */
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
  globalThis.__denialAppealsSql = undefined;
}

export { schema };
