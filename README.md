# Trip Planner

A collaborative trip planner. Currently at **Milestone 4**: a persistent, single-user trip
whose stops are real, geocoded places shown on a Google map, connected by the real driving
route between them.

```
frontend/   Vite + React + TS + React Router + Google Maps (runs on your machine)
backend/    Node + Express + TypeScript + Drizzle ORM (runs in Docker)
shared/     placeholder — shared TS types land here in a later milestone
```

## Prerequisites

- Docker Desktop (for Postgres + backend)
- Node.js 20+ and npm (for the frontend)
- A Google Maps Platform API key and Map ID — see [Google Maps setup](#google-maps-setup)

## Run it

**1. Start Postgres and the backend** — from the repo root:

```
docker compose up
```

Migrations apply automatically on startup, before the server begins listening.

**2. Start the frontend** — in a second terminal:

```
cd frontend
cp .env.example .env     # then paste in your API key and Map ID
npm install
npm run dev
```

Without those two values the app still runs, but the map and place search are replaced by
a message naming the variable that is missing.

| What | Where |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend health check | http://localhost:3000/health |
| Postgres | `localhost:5432` (user/password/db all `tripplanner`) |

## Using it

1. Open http://localhost:5173, type a trip name, press **Create trip**.
2. You land on `/trip/<uuid>` — that URL is the trip. Bookmark or share it.
3. Search for a real place and pick it from the suggestions. It is added as a stop with
   its real coordinates, address, and place id, and appears as a numbered pin.
4. Rename, delete, and move stops up/down. Pin numbers follow the list order.
   Refresh; everything persists.
5. With two or more stops, the map draws the driving route between them in itinerary
   order and shows total distance and drive time.

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
| `address`, `place_id` | text | nullable; filled from the Places selection |
| `latitude`, `longitude` | double precision | nullable; filled from the Places selection |
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
| `POST` | `/api/trips/:tripId/stops` | `{name, address, placeId, lat, lng}` | `201` the new stop, appended |
| `PATCH` | `/api/stops/:stopId` | `{name}` | the renamed stop |
| `DELETE` | `/api/stops/:stopId` | — | `204` |
| `PATCH` | `/api/stops/:stopId/reorder` | `{beforeId, afterId}` | the moved stop |
| `GET` | `/api/trips/:tripId/route` | — | `{encodedPolyline, distanceMeters, durationSeconds}`, or `{route: null}` |

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

# append a geocoded stop (substitute the trip id from above)
# name, lat and lng are required; address and placeId are optional
curl -s -X POST http://localhost:3000/api/trips/$TRIP/stops \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tokyo Tower","address":"4-2-8 Shibakoen, Minato City, Tokyo","placeId":"ChIJCzYy5IuLGGARQ2RaEUdvJGA","lat":35.6585805,"lng":139.7454329}'

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

## Google Maps setup

You need **one API key** and **one Map ID**. The Map ID is not a second key — it is a style
identifier that `AdvancedMarker` requires.

### In the Google Cloud console

1. Create or pick a project, and make sure **billing is enabled** — Maps will not serve
   requests without it.
2. **APIs & Services -> Library**, enable both:
   - **Maps JavaScript API**
   - **Places API (New)** — that one specifically, not the legacy "Places API"
3. **APIs & Services -> Credentials -> Create credentials -> API key**, then **Edit** it:
   - *Application restrictions* -> **Websites**, add `http://localhost:5173/*`
   - *API restrictions* -> **Restrict key**, tick **Maps JavaScript API** and
     **Places API (New)**

   That single key now serves both the map and the search.
4. **Google Maps Platform -> Map management -> Create Map ID.** Map type **JavaScript**;
   raster or vector both work, but the ID is mandatory for `AdvancedMarker`.

   For local development you can skip this and set `VITE_GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID`
   — Google's official testing placeholder, which is what this repo's `.env` uses. Create
   a real Map ID before deploying anywhere public.
5. **Billing -> Budgets & alerts**, set a budget, and optionally cap requests per API under
   *APIs & Services -> Quotas*. Do this before you start clicking around.

### Frontend environment variables

Both live in a gitignored `frontend/.env`; `frontend/.env.example` is the committed template.

| Variable | What it is |
| --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | The single API key, restricted to both APIs above |
| `VITE_GOOGLE_MAPS_MAP_ID` | The Map ID, required by `AdvancedMarker` |

**The key is used in the browser.** That is how Maps JavaScript works and is expected — it
is secured by the referrer and API restrictions from step 3, not by hiding it. Proxying it
through the backend would not help and is deliberately not done.

Note that Vite only exposes `VITE_`-prefixed variables, and only from its **own**
directory. A key in `backend/.env` is invisible to the frontend — it has to live in
`frontend/.env` as `VITE_GOOGLE_MAPS_API_KEY`. The backend makes no Google calls at all in
this milestone.

### Why `PlaceAutocompleteElement`, not the classic widget

Since **1 March 2025**, `google.maps.places.Autocomplete` and `AutocompleteService` are
**unavailable to new customers**. This project is new, so they would simply fail. The search
box uses the current `google.maps.places.PlaceAutocompleteElement` (Places API New) instead.
The npm wrappers `react-google-places-autocomplete`, `use-places-autocomplete`, and
`react-google-autocomplete` are all built on the retired APIs and are avoided for the same
reason.

### Keeping the bill down

- The Maps script loads **exactly once**, from a single `<APIProvider>` wrapping the trip
  page. The map and the search share that one load and that one key.
- `PlaceAutocompleteElement` manages its own **session token**: the first `fetchFields()`
  on a `Place` from `toPlace()` reuses the token from the keystrokes that produced it, so a
  search plus its detail lookup bills as **one session** instead of per request. Nothing
  else in the app calls Places.
- Only three fields are requested — `displayName`, `formattedAddress`, `location`. Fewer
  fields means a cheaper tier. (`id` is not requestable; it is already on the object.)

## Routing

`GET /api/trips/:tripId/route` computes the driving route through the trip's stops in rank
order and returns:

```json
{ "encodedPolyline": "ipkcFfich…", "distanceMeters": 615000, "durationSeconds": 21600 }
```

When there are fewer than two stops with coordinates there is nothing to draw, and it
returns `{ "route": null }` instead.

The frontend converts the raw numbers for display:

| Raw | Conversion | Shown |
| --- | --- | --- |
| `distanceMeters` | `meters / 1609.344`, one decimal | `382.2 mi` |
| `durationSeconds` | seconds -> minutes, then h + min | `6 h 0 min` |

The `encodedPolyline` is a compressed string of coordinates. The browser expands it with
the Maps `geometry` library (`decodePath`) and draws a single `google.maps.Polyline`. The
effect's cleanup removes the previous line before drawing a new one, so routes never stack.

### Why the Routes API, not DirectionsService

`google.maps.DirectionsService`, `DirectionsRenderer`, and `DistanceMatrixService` were
**deprecated on 25 February 2026**. This project uses the **Routes API**
(`POST https://routes.googleapis.com/directions/v2:computeRoutes`) instead, called
**server-side only**.

### Routes API setup

This needs a **second, separate API key** from the frontend one. The frontend key is HTTP
referrer restricted, and a referrer-restricted key is rejected for server-side calls with
`API_KEY_HTTP_REFERRER_BLOCKED` — so it cannot be reused here.

1. **APIs & Services -> Library**, enable the **Routes API**.
2. **Credentials -> Create credentials -> API key.** Then **Edit**:
   - *Application restrictions* -> **IP addresses** (add your server's IP). For local-only
     development you may leave it unrestricted, but never do that for a deployed key.
   - *API restrictions* -> **Restrict key** -> **Routes API** only.
3. **Billing -> Budgets & alerts**: set a budget, and consider a per-API quota cap under
   *APIs & Services -> Quotas*. Routing is billed per request.
4. Put it in `backend/.env`:

   ```
   GOOGLE_ROUTES_API_KEY=your-routes-api-key-here
   ```

   `backend/.env` is gitignored; `backend/.env.example` holds the placeholder.

**This key must never reach the browser.** It has no `VITE_` prefix, it is read only in
`backend/src/services/googleRoutes.ts`, and it is never included in a response body. If it
is missing the endpoint returns a readable `502` rather than crashing the server.

### Keeping routing costs down

- The `X-Goog-FieldMask` header requests only three fields:
  `routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration`.
- The frontend **debounces** route refetches by 500 ms, so a burst of move-up/move-down
  clicks results in one request, not one per click.
- Routes are only requested when at least two located stops exist.
- The backend caches the last result in memory, keyed by the ordered stop ids. Renaming a
  stop does not change that key, so it does not trigger a recompute; adding, removing, or
  reordering does.

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

No realtime/WebSockets, no drag-and-drop, no "Get Directions" handoff to Google Maps, no
auth or accounts, and `shared/` is still an empty placeholder.
