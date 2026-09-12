# Trip Planner

A collaborative trip planner. Currently at **Milestone 2**: a persistent, single-user trip
with ordered stops over plain HTTP.

```
frontend/   Vite + React + TypeScript + React Router (runs on your machine)
backend/    Node + Express + TypeScript + Drizzle ORM (runs in Docker)
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

Migrations apply automatically on startup, before the server begins listening.

**2. Start the frontend** — in a second terminal:

```
cd frontend
npm install
npm run dev
```

| What | Where |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend health check | http://localhost:3000/health |
| Postgres | `localhost:5432` (user/password/db all `tripplanner`) |

## Using it

1. Open http://localhost:5173, type a trip name, press **Create trip**.
2. You land on `/trip/<uuid>` — that URL is the trip. Bookmark or share it.
3. Add stops, rename, delete, and move them up/down. Refresh; the order persists.

## Data model

**trips**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK, `gen_random_uuid()` |
| `name` | text | not null |
| `created_at` / `updated_at` | timestamptz | not null, default `now()` |

**stops**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK, `gen_random_uuid()` |
| `trip_id` | uuid | not null, FK → `trips(id)` **ON DELETE CASCADE** |
| `name` | text | not null |
| `address`, `place_id` | text | nullable — **milestone 3** fills these |
| `latitude`, `longitude` | double precision | nullable — **milestone 3** |
| `rank` | text | not null; fractional index, order is `ORDER BY rank ASC` |
| `created_at` / `updated_at` | timestamptz | not null, default `now()` |

Index on `stops(trip_id, rank)` — the exact shape of every list query.

### Why `rank` is text, not a number

Stop order is a **fractional index**: a short string key where sort order *is* list order.
To move a stop between two others, we mint a new key strictly between its two new
neighbours' keys — `"a0"` and `"a1"` yield `"a0V"`. Only the moved row is written. With
integer positions you'd have to renumber every row after the insertion point.

## Migrations

Schema lives in [backend/src/db/schema.ts](backend/src/db/schema.ts). After editing it:

```
cd backend
npm run db:generate      # drizzle-kit generate -> backend/drizzle/*.sql
```

Read the generated SQL, commit it, then restart the backend — `runMigrations()` in
[backend/src/db.ts](backend/src/db.ts) applies anything not yet recorded in the
`drizzle.__drizzle_migrations` table before Express starts listening.

Generating and applying are deliberately separate: you generate on the host, the container
applies. The container uses the in-network `DATABASE_URL` (host `postgres`), so there's no
host/port mismatch to reconcile.

## API

All JSON, all prefixed `/api`. `404` for a missing trip/stop, `400` for bad input.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/api/trips` | `{name}` | `201` the trip |
| `GET` | `/api/trips/:tripId` | — | `{trip, stops}`, stops in `rank ASC` order |
| `POST` | `/api/trips/:tripId/stops` | `{name}` | `201` the new stop, appended |
| `PATCH` | `/api/stops/:stopId` | `{name}` | the renamed stop |
| `DELETE` | `/api/stops/:stopId` | — | `204` |
| `PATCH` | `/api/stops/:stopId/reorder` | `{beforeId, afterId}` | the moved stop |

### Reorder is neighbour-based

`beforeId` is the stop that should end up directly **above** the one being moved;
`afterId` the one directly **below**. Either may be `null`, meaning top or bottom of the
list. The server looks up those two ranks, mints a rank between them, and updates
**exactly one row**.

It deliberately does *not* accept "here is the whole new order" — that contract is what
lets a later milestone make reordering concurrent-safe without a rewrite.

Rejections: `400` if the neighbours aren't in ascending order or a stop is passed as its
own neighbour; `404` if a neighbour belongs to a different trip.

### curl examples

```bash
# create a trip
curl -s -X POST http://localhost:3000/api/trips \
  -H 'Content-Type: application/json' -d '{"name":"Japan 2026"}'

# append a stop  (substitute the trip id from above)
curl -s -X POST http://localhost:3000/api/trips/$TRIP/stops \
  -H 'Content-Type: application/json' -d '{"name":"Tokyo"}'

# read the trip back, stops already in order
curl -s http://localhost:3000/api/trips/$TRIP

# rename a stop
curl -s -X PATCH http://localhost:3000/api/stops/$STOP \
  -H 'Content-Type: application/json' -d '{"name":"Tokyo (3 nights)"}'

# move $STOP to the very top: nothing above it, $FIRST below it
curl -s -X PATCH http://localhost:3000/api/stops/$STOP/reorder \
  -H 'Content-Type: application/json' -d '{"beforeId":null,"afterId":"'$FIRST'"}'

# delete a stop
curl -s -X DELETE http://localhost:3000/api/stops/$STOP -o /dev/null -w '%{http_code}\n'
```

## How it works

1. **Browser → backend.** React calls `${VITE_API_URL}/api/...`. The page is on port 5173
   and the API on 3000 — different origins, so the `cors` middleware must name 5173 before
   the browser will hand the response to your JavaScript.
2. **Backend → database.** Express routes call Drizzle, which runs SQL over the same
   node-postgres **connection pool** created in `db.ts`.
3. **Answer back.** Rows return as typed objects; React re-renders.

Inside the Docker network the backend reaches Postgres at hostname **`postgres`** — the
Compose service name. `localhost` inside a container means *that container*. Running the
backend on your host instead, it uses `localhost:5432`, which is why the two connection
strings differ.

## Data persistence

Postgres data lives in the named volume `postgres-data`, so it survives restarts and
`docker compose down`. To wipe it deliberately: `docker compose down -v`.

## Known rough edges on Windows

**Backend hot reload does not work inside Docker.** The bind mount propagates file
*contents*, but Docker Desktop for Windows doesn't deliver file-change *events*, and
`tsx watch` relies on them. After editing backend source:

```
docker compose restart backend
```

Or run the backend on the host, where hot reload works normally — `cp backend/.env.example
backend/.env` then `cd backend && npm run dev`, leaving only Postgres in Docker. Frontend
HMR is unaffected.

**After changing backend dependencies**, rebuild the `node_modules` volume or the container
will run with the old packages:

```
docker compose up --build --renew-anon-volumes
```

`--renew-anon-volumes` rebuilds only the anonymous `node_modules` volume; your Postgres
data is in a *named* volume and is untouched.

## Not in this milestone

No realtime/WebSockets, no maps or geocoding, no drag-and-drop, no auth or accounts, and
`shared/` is still an empty placeholder.
