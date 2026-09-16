/**
 * drizzle-kit configuration.
 *
 * Loads .env.local so `npm run db:generate` and `npm run db:push` work from a
 * plain shell without exporting DATABASE_URL by hand.
 */

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local before running drizzle-kit.");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  // strict would force an interactive confirmation on every push, which has no
  // TTY under npm scripts. scripts/db/push.ts passes --force instead.
  strict: false,
  verbose: true,
});
