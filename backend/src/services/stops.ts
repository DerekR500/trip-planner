import { and, asc, desc, eq } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";

import type { Stop as WireStop, Trip as WireTrip } from "../../../shared/protocol.js";
import { db } from "../db.js";
import { stops, trips } from "../db/schema.js";
import type { Stop as DbStop, Trip as DbTrip } from "../db/schema.js";
import { isUuid, parseCoordinate, parseName, parseOptionalText } from "../routes/helpers.js";

/**
 * Anything the caller should report back to the user rather than treat as a crash.
 * Over HTTP this becomes a 400/404; over the websocket it becomes an 'error' message
 * addressed to the sender alone.
 */
export class StopServiceError extends Error {}

/** Drizzle hands back Date objects; the wire protocol says ISO strings. Convert once, here. */
function toWireStop(stop: DbStop): WireStop {
  return {
    id: stop.id,
    tripId: stop.tripId,
    name: stop.name,
    address: stop.address,
    placeId: stop.placeId,
    latitude: stop.latitude,
    longitude: stop.longitude,
    rank: stop.rank,
    createdAt: stop.createdAt.toISOString(),
    updatedAt: stop.updatedAt.toISOString(),
  };
}

function toWireTrip(trip: DbTrip): WireTrip {
  return {
    id: trip.id,
    name: trip.name,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
}

function requireUuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new StopServiceError(`${label} must be a uuid`);
  return value;
}

/** The trip plus its stops in rank order, or null when the trip does not exist. */
export async function loadTripState(
  tripId: string,
): Promise<{ trip: WireTrip; stops: WireStop[] } | null> {
  if (!isUuid(tripId)) return null;

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return null;

  const rows = await db
    .select()
    .from(stops)
    .where(eq(stops.tripId, tripId))
    .orderBy(asc(stops.rank));

  return { trip: toWireTrip(trip), stops: rows.map(toWireStop) };
}

export async function addStop(input: {
  tripId: string;
  name: unknown;
  address: unknown;
  placeId: unknown;
  lat: unknown;
  lng: unknown;
}): Promise<WireStop> {
  const tripId = requireUuid(input.tripId, "tripId");

  const name = parseName(input.name);
  if (name === null) throw new StopServiceError("name is required");

  const latitude = parseCoordinate(input.lat, 90);
  const longitude = parseCoordinate(input.lng, 180);
  if (latitude === null || longitude === null) {
    throw new StopServiceError("lat and lng are required numbers");
  }

  const [trip] = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId));
  if (!trip) throw new StopServiceError("Trip not found");

  // Highest rank = the current last stop; undefined when the trip has no stops yet.
  const [last] = await db
    .select({ rank: stops.rank })
    .from(stops)
    .where(eq(stops.tripId, tripId))
    .orderBy(desc(stops.rank))
    .limit(1);

  const [created] = await db
    .insert(stops)
    .values({
      tripId,
      name,
      rank: generateKeyBetween(last?.rank ?? null, null),
      address: parseOptionalText(input.address),
      placeId: parseOptionalText(input.placeId, 255),
      latitude,
      longitude,
    })
    .returning();

  return toWireStop(created);
}

export async function renameStop(
  tripId: string,
  stopId: unknown,
  rawName: unknown,
): Promise<WireStop> {
  requireUuid(tripId, "tripId");
  const id = requireUuid(stopId, "stopId");

  const name = parseName(rawName);
  if (name === null) throw new StopServiceError("name is required");

  const [updated] = await db
    .update(stops)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(stops.id, id), eq(stops.tripId, tripId)))
    .returning();

  if (!updated) throw new StopServiceError("Stop not found");
  return toWireStop(updated);
}

export async function removeStop(tripId: string, stopId: unknown): Promise<string> {
  requireUuid(tripId, "tripId");
  const id = requireUuid(stopId, "stopId");

  const [deleted] = await db
    .delete(stops)
    .where(and(eq(stops.id, id), eq(stops.tripId, tripId)))
    .returning({ id: stops.id });

  if (!deleted) throw new StopServiceError("Stop not found");
  return deleted.id;
}

/**
 * Neighbour-based reorder: mint a rank strictly between the two neighbours and write
 * exactly one row. Neighbours are never touched, which is what keeps this safe to run
 * concurrently from several clients.
 */
export async function reorderStop(
  tripId: string,
  stopId: unknown,
  beforeId: unknown,
  afterId: unknown,
): Promise<WireStop> {
  requireUuid(tripId, "tripId");
  const id = requireUuid(stopId, "stopId");

  const before = beforeId ?? null;
  const after = afterId ?? null;
  if ((before !== null && !isUuid(before)) || (after !== null && !isUuid(after))) {
    throw new StopServiceError("beforeId and afterId must each be a uuid or null");
  }
  if (before === id || after === id) {
    throw new StopServiceError("A stop cannot be its own neighbour");
  }

  const [stop] = await db
    .select()
    .from(stops)
    .where(and(eq(stops.id, id), eq(stops.tripId, tripId)));
  if (!stop) throw new StopServiceError("Stop not found");

  async function rankOf(neighbourId: string | null): Promise<string | null | undefined> {
    if (neighbourId === null) return null;
    const [row] = await db
      .select({ rank: stops.rank })
      .from(stops)
      .where(and(eq(stops.id, neighbourId), eq(stops.tripId, tripId)));
    return row?.rank;
  }

  const beforeRank = await rankOf(before as string | null);
  const afterRank = await rankOf(after as string | null);
  if (beforeRank === undefined || afterRank === undefined) {
    throw new StopServiceError("Neighbour stop not found in this trip");
  }

  // fractional-indexing v4 silently SWAPS out-of-order arguments rather than throwing,
  // so the bad-ordering check has to happen here or a caller would get a successful
  // move to a position it never asked for.
  if (beforeRank !== null && afterRank !== null && beforeRank >= afterRank) {
    throw new StopServiceError("beforeId and afterId are not in ascending order");
  }

  let rank: string;
  try {
    rank = generateKeyBetween(beforeRank, afterRank);
  } catch {
    throw new StopServiceError("Could not compute a rank between those neighbours");
  }

  const [updated] = await db
    .update(stops)
    .set({ rank, updatedAt: new Date() })
    .where(eq(stops.id, id))
    .returning();

  return toWireStop(updated);
}
