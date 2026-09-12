import "dotenv/config";

import { defineConfig } from "drizzle-kit";

// Used by the drizzle-kit CLI only (npm run db:generate). The running server never
// reads this file — it migrates itself on startup via runMigrations().
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://tripplanner:tripplanner@localhost:5432/tripplanner",
  },
});
