import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Router } from "express";

import { db } from "../db.js";
import { stops, trips } from "../db/schema.js";
import {
  computeRoute,
  MAX_INTERMEDIATES,
  RoutesApiError,
  type ComputedRoute,
} from "../services/googleRoutes.js";
import { isUuid, parseName } from "./helpers.js";

export const tripsRouter = Router();

/** POST /api/trips — create a trip. */
tripsRouter.post("/", async (req, res) => {
  const name = parseName(req.body?.name);
  if (name === null) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [trip] = await db.insert(trips).values({ name }).returning();
  res.status(201).json(trip);
});

/** GET /api/trips/:tripId — the trip plus its stops, already in display order. */
tripsRouter.get("/:tripId", async (req, res) => {
  const { tripId } = req.params;
  if (!isUuid(tripId)) {
    res.status(400).json({ error: "tripId must be a uuid" });
    return;
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const tripStops = await db
    .select()
    .from(stops)
    .where(eq(stops.tripId, tripId))
    .orderBy(asc(stops.rank));

  res.json({ trip, stops: tripStops });
});

/**
 * Last computed route per ordered stop list. The key is the stop ids in rank order, so it
 * changes the moment a stop is added, removed, or moved — no explicit invalidation needed,
 * and a rename (which does not change the route) reuses the cached value.
 */
const routeCache = new Map<string, ComputedRoute>();
const ROUTE_CACHE_LIMIT = 100;

function rememberRoute(key: string, route: ComputedRoute): void {
  // Bound the map so a long-lived server cannot grow it forever. Oldest key wins eviction;
  // Map preserves insertion order, so the first key is the oldest.
  if (routeCache.size >= ROUTE_CACHE_LIMIT) {
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(key, route);
}

/**
 * GET /api/trips/:tripId/route — driving route through the trip's stops in rank order.
 *
 * Returns { route: null } when there is nothing to draw (fewer than two located stops),
 * otherwise { encodedPolyline, distanceMeters, durationSeconds }.
 */
tripsRouter.get("/:tripId/route", async (req, res) => {
  const { tripId } = req.params;
  if (!isUuid(tripId)) {
    res.status(400).json({ error: "tripId must be a uuid" });
    return;
  }

  const [trip] = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  // Stops without coordinates (possible for rows created before milestone 3) cannot be
  // routed through, so they are skipped rather than breaking the whole request.
  const located = await db
    .select()
    .from(stops)
    .where(
      and(eq(stops.tripId, tripId), isNotNull(stops.latitude), isNotNull(stops.longitude)),
    )
    .orderBy(asc(stops.rank));

  if (located.length < 2) {
    res.json({ route: null });
    return;
  }

  const intermediateCount = located.length - 2;
  if (intermediateCount > MAX_INTERMEDIATES) {
    res.status(400).json({
      error: `This trip has ${String(intermediateCount)} intermediate stops; the Routes API allows at most ${String(MAX_INTERMEDIATES)}.`,
    });
    return;
  }

  const cacheKey = located.map((stop) => stop.id).join(",");
  const cached = routeCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const route = await computeRoute(
      located.map((stop) => ({ latitude: stop.latitude!, longitude: stop.longitude! })),
    );
    rememberRoute(cacheKey, route);
    res.json(route);
  } catch (err: unknown) {
    if (err instanceof RoutesApiError) {
      console.error("Routes API failed:", err.message);
      res.status(502).json({ error: err.message });
      return;
    }
    throw err;
  }
});
