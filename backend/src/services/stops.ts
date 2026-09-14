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

/**
 * The canonical ordering, used everywhere stops are read in order.
 *
 * The `id` tie-breaker matters: if two stops ever end up with an identical rank, sorting
 * by rank alone leaves the order up to the database, and two clients could legitimately
 * render them differently forever. Sorting by (rank, id) makes any tie resolve the same
 * way on every client and on the server.
 */
async function orderedStops(tripId: string): Promise<DbStop[]> {
  return db
    .select()
    .from(stops)
    .where(eq(stops.tripId, tripId))
    .orderBy(asc(stops.rank), asc(stops.id));
}

/** The trip plus its stops in rank order, or null when the trip does not exist. */
export async function loadTripState(
  tripId: string,
): Promise<{ trip: WireTrip; stops: WireStop[] } | null> {
  if (!isUuid(tripId)) return null;

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return null;

  return { trip: toWireTrip(trip), stops: (await orderedStops(tripId)).map(toWireStop) };
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
 * Turns the client's requested neighbours into a slot in the CURRENT list.
 *
 * By the time a drag reaches the server, the neighbours it named may have moved or been
 * deleted by someone else. Rather than reject the move (which would make a perfectly
 * reasonable drag fail for reasons the user cannot see), we resolve to the nearest
 * sensible slot and carry on:
 *
 *   - beforeId names a stop that still exists -> sit directly after it
 *   - beforeId is explicitly null            -> the top of the list
 *   - beforeId is gone but afterId survives  -> sit directly before afterId
 *   - both are gone                          -> append to the end
 *
 * Returns an index into `others` (the list without the stop being moved), so the
 * surrounding ranks are always genuinely adjacent and genuinely ascending.
 */
function resolveSlot(
  others: DbStop[],
  beforeId: string | null,
  afterId: string | null,
): number {
  if (beforeId === null) return 0;

  const beforeIndex = others.findIndex((s) => s.id === beforeId);
  if (beforeIndex !== -1) return beforeIndex + 1;

  const afterIndex = afterId === null ? -1 : others.findIndex((s) => s.id === afterId);
  if (afterIndex !== -1) return afterIndex;

  return others.length;
}

/**
 * Neighbour-based reorder: mint a rank strictly between the two neighbours and write
 * exactly one row. Neighbours are never touched, which is what keeps concurrent drags of
 * DIFFERENT stops from clobbering each other.
 *
 * Callers must run this through the per-trip queue (see ws/queue.ts) so the read below
 * sees committed state — otherwise two simultaneous moves could compute the same rank.
 */
export async function reorderStop(
  tripId: string,
  stopId: unknown,
  beforeId: unknown,
  afterId: unknown,
): Promise<WireStop> {
  requireUuid(tripId, "tripId");
  const id = requireUuid(stopId, "stopId");

  const before = (beforeId ?? null) as string | null;
  const after = (afterId ?? null) as string | null;
  if ((before !== null && !isUuid(before)) || (after !== null && !isUuid(after))) {
    throw new StopServiceError("beforeId and afterId must each be a uuid or null");
  }

  const current = await orderedStops(tripId);
  const stop = current.find((s) => s.id === id);
  // Someone deleted this stop while the drag was in flight. The sender rolls back.
  if (!stop) throw new StopServiceError("Stop not found");

  // Excluding the moved stop is what lets it be dropped next to where it already was
  // without the neighbour lookup finding itself.
  const others = current.filter((s) => s.id !== id);
  const slot = resolveSlot(others, before, after);

  // Both neighbours come from one sorted array, so they are adjacent and ascending by
  // construction — generateKeyBetween cannot be handed an inverted pair here.
  const beforeRank = slot > 0 ? others[slot - 1].rank : null;
  const afterRank = slot < others.length ? others[slot].rank : null;

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
