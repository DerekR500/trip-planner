import "dotenv/config";

import cors from "cors";
import express from "express";

import { pingDatabase, pool } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// The frontend runs on its own origin (the Vite dev server), so the browser needs
// permission from us before it will hand the response to the page's JavaScript.
app.use(cors({ origin: corsOrigin }));

app.get("/health", async (_req, res) => {
  try {
    await pingDatabase();
    res.json({ server: "ok", db: "ok" });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(503).json({ server: "ok", db: "error" });
  }
});

const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

// Docker sends SIGTERM on `docker compose down`/restart; close cleanly so Postgres
// isn't left holding connections.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
