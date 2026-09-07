# Trip Planner — Milestone 1 (walking skeleton)

A collaborative real-time trip planner. This milestone contains **no product features**. It
exists to prove one thing: the frontend, the backend, and the database can talk to each
other, and there is a dev loop that reloads on save.

```
frontend/   Vite + React + TypeScript (runs on your machine)
backend/    Node + Express + TypeScript (runs in Docker)
shared/     placeholder — shared TS types land here in a later milestone
```

## Prerequisites

- Docker Desktop (for Postgres + backend)
- Node.js 20+ and npm (for the frontend)

## Run it

**1. Start Postgres and the backend** — from the repo root:

```
docker compose up
```

**2. Start the frontend** — in a second terminal:

```
cd frontend
npm install
npm run dev
```

**URLs**

| What | Where |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend health check | http://localhost:3000/health |
| Postgres | `localhost:5432` (user/password/db all `tripplanner`) |

When it's working, http://localhost:5173 shows **"Backend: ok / Database: ok"** and
http://localhost:3000/health returns:

```json
{ "server": "ok", "db": "ok" }
```

If the database is unreachable, `/health` returns HTTP **503** with
`{ "server": "ok", "db": "error" }`, and the page shows that instead — the server being up
and the database being up are reported separately on purpose.

## How it works

The round-trip has three hops:

1. **Browser → backend.** When the page loads, React runs one `fetch` against
   `${VITE_API_URL}/health` (default `http://localhost:3000`). Because the page is served
   from port 5173 and the API lives on port 3000, these are different *origins*, so the
   browser will only hand the response to your JavaScript if the API says it's allowed —
   that's what the `cors` middleware in the backend does.

2. **Backend → database.** Express handles `GET /health` by running `SELECT 1` through a
   node-postgres **connection pool**. A pool keeps a small set of open connections and
   hands them out per query, which is much cheaper than dialing Postgres from scratch each
   time. `SELECT 1` does no real work — it just proves the database is reachable and
   answering.

3. **Answer back up the chain.** If the query succeeds the backend replies `db: "ok"`; if it
   throws, it replies `503` with `db: "error"`. React renders whichever came back.

The one piece of Docker networking worth internalizing: **inside** the Docker network the
backend reaches the database at the hostname `postgres` — the service name from
`docker-compose.yml`, which Docker's internal DNS resolves to the right container.
`localhost` inside a container means *that container*, not your machine. If you instead run
the backend directly on your machine (`cd backend && npm run dev`), it connects to
`localhost:5432`, because Compose publishes that port to the host. That's the only
difference between the two connection strings.

## Configuration

Real `.env` files are gitignored; the committed `.env.example` files are the templates.

```
cp backend/.env.example backend/.env      # only needed to run the backend outside Docker
cp frontend/.env.example frontend/.env    # optional; the app defaults to localhost:3000
```

`docker-compose.yml` passes the backend's environment in directly, so `backend/.env` is not
consulted when you run under Compose.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PORT` | backend | Port Express listens on (3000) |
| `DATABASE_URL` | backend | Postgres connection string |
| `CORS_ORIGIN` | backend | Origin allowed to call the API |
| `VITE_API_URL` | frontend | Backend base URL, inlined at build time |

## Data persistence

Postgres data lives in a named Docker volume (`postgres-data`), so it survives restarts and
`docker compose down`. To verify:

```
docker compose exec postgres psql -U tripplanner -d tripplanner -c "CREATE TABLE ping (id int);"
docker compose down
docker compose up -d
docker compose exec postgres psql -U tripplanner -d tripplanner -c "\dt"   # ping is still there
```

To wipe it deliberately: `docker compose down -v`.

## Dev loop

- **Backend**: `backend/` is bind-mounted into the container and runs under `tsx watch`, so
  saving a `.ts` file restarts the server. If file-change events don't propagate through
  the bind mount on your machine, run the backend directly instead — `cd backend && npm run
  dev` with `backend/.env` in place — and leave only Postgres in Docker.
- **Frontend**: Vite HMR, as usual.

## Not in this milestone

No application tables, no ORM or migrations (Drizzle arrives later and will reuse the same
pool in [backend/src/db.ts](backend/src/db.ts)), no auth, no websockets, no maps.
