import "dotenv/config";

import { createServer } from "node:http";

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { pingDatabase, pool, runMigrations } from "./db.js";
import { tripsRouter } from "./routes/trips.js";
import { attachWebSocketServer } from "./ws/server.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// The frontend runs on its own origin (the Vite dev server), so the browser needs
// permission from us before it will hand the response to the page's JavaScript.
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await pingDatabase();
    res.json({ server: "ok", db: "ok" });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(503).json({ server: "ok", db: "error" });
  }
});

// Stop mutations moved to the websocket in milestone 5. What is left over HTTP is
// trip creation, the initial page load, and routing.
app.use("/api/trips", tripsRouter);

// Express 5 forwards a rejected promise from any handler to here, so the routes
// above don't need try/catch of their own. Four parameters is what marks this as
// error-handling middleware, hence the unused _next.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled route error:", err);
  res.status(500).json({ error: "Internal server error" });
});

async function main(): Promise<void> {
  // Migrate before listening: the schema is never behind the code serving requests.
  await runMigrations();
  console.log("Migrations applied.");

  // Create the HTTP server explicitly so the WebSocket server can share it: ws then
  // lives on the same port 3000 as Express, needing no extra published port.
  const server = createServer(app);
  attachWebSocketServer(server);

  server.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port} (HTTP + WebSocket)`);
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
}

main().catch((err: unknown) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
