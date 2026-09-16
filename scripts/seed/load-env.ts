/**
 * Loads .env.local. Import this first in any script entry point: module
 * evaluation follows import order, and src/lib/db/client.ts reads
 * DATABASE_URL when it is first imported.
 */

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
