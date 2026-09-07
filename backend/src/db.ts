import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env, or run via docker compose.");
}

/**
 * A single shared connection pool for the whole process.
 * Later milestones (Drizzle) will wrap this same pool rather than opening their own.
 */
export const pool = new Pool({ connectionString });

// Without this, an idle client dropped by the server (restart, network blip) surfaces as an
// unhandled 'error' event and takes the process down.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});

/** Cheapest possible round-trip to prove the database is reachable and answering. */
export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}
