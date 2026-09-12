import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import * as schema from "./db/schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env, or run via docker compose.");
}

/**
 * A single shared connection pool for the whole process.
 * Drizzle wraps this pool rather than opening connections of its own.
 */
export const pool = new Pool({ connectionString });

// Without this, an idle client dropped by the server (restart, network blip) surfaces as an
// unhandled 'error' event and takes the process down.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});

/** Query builder used by every route. `schema` gives the result rows their types. */
export const db = drizzle(pool, { schema });

/** Cheapest possible round-trip to prove the database is reachable and answering. */
export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

/**
 * Applies any migration files not yet recorded in Drizzle's bookkeeping table.
 * Runs before the server listens, so the schema is never behind the code.
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
}
