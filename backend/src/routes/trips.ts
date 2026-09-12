import { asc, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { generateKeyBetween } from "fractional-indexing";

import { db } from "../db.js";
import { stops, trips } from "../db/schema.js";
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

/** POST /api/trips/:tripId/stops — append a stop after the current last one. */
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
  const [stop] = await db.insert(stops).values({ tripId, name, rank }).returning();
  res.status(201).json(stop);
});
