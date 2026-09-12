import { asc, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { generateKeyBetween } from "fractional-indexing";

import { db } from "../db.js";
import { stops, trips } from "../db/schema.js";
import { isUuid, parseCoordinate, parseName, parseOptionalText } from "./helpers.js";

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
 * POST /api/trips/:tripId/stops — append a geocoded stop after the current last one.
 *
 * Body { name, address, placeId, lat, lng }. The coordinates come from the browser's
 * Places selection, so the server does no geocoding of its own. address and placeId are
 * optional; name/lat/lng are not.
 */
tripsRouter.post("/:tripId/stops", async (req, res) => {
  const { tripId } = req.params;
  if (!isUuid(tripId)) {
    res.status(400).json({ error: "tripId must be a uuid" });
    return;
  }

  const name = parseName(req.body?.name);
  if (name === null) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const latitude = parseCoordinate(req.body?.lat, 90);
  const longitude = parseCoordinate(req.body?.lng, 180);
  if (latitude === null || longitude === null) {
    res.status(400).json({ error: "lat and lng are required numbers" });
    return;
  }

  const address = parseOptionalText(req.body?.address);
  const placeId = parseOptionalText(req.body?.placeId, 255);

  const [trip] = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  // Highest rank = the current last stop; undefined when the trip has no stops yet.
  const [last] = await db
    .select({ rank: stops.rank })
    .from(stops)
    .where(eq(stops.tripId, tripId))
    .orderBy(desc(stops.rank))
    .limit(1);

  const rank = generateKeyBetween(last?.rank ?? null, null);
  const [stop] = await db
    .insert(stops)
    .values({ tripId, name, rank, address, placeId, latitude, longitude })
    .returning();
  res.status(201).json(stop);
});
