import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { generateKeyBetween } from "fractional-indexing";

import { db } from "../db.js";
import { stops } from "../db/schema.js";
import { isUuid, parseName } from "./helpers.js";

export const stopsRouter = Router();

/** PATCH /api/stops/:stopId — rename a stop. */
stopsRouter.patch("/:stopId", async (req, res) => {
  const { stopId } = req.params;
  if (!isUuid(stopId)) {
    res.status(400).json({ error: "stopId must be a uuid" });
    return;
  }

  const name = parseName(req.body?.name);
  if (name === null) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [updated] = await db
    .update(stops)
    .set({ name, updatedAt: new Date() })
    .where(eq(stops.id, stopId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }

  res.json(updated);
});

/** DELETE /api/stops/:stopId */
stopsRouter.delete("/:stopId", async (req, res) => {
  const { stopId } = req.params;
  if (!isUuid(stopId)) {
    res.status(400).json({ error: "stopId must be a uuid" });
    return;
  }

  const [deleted] = await db
    .delete(stops)
    .where(eq(stops.id, stopId))
    .returning({ id: stops.id });

  if (!deleted) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }

  res.status(204).end();
});

/**
 * PATCH /api/stops/:stopId/reorder — body { beforeId, afterId }, either may be null.
 *
 * beforeId is the stop that should end up directly ABOVE this one, afterId the stop
 * directly BELOW. We mint a rank strictly between their two ranks and write exactly
 * one row: the stop being moved. Its neighbours are never touched, which is what
 * makes this safe to make concurrent later.
 */
stopsRouter.patch("/:stopId/reorder", async (req, res) => {
  const { stopId } = req.params;
  if (!isUuid(stopId)) {
    res.status(400).json({ error: "stopId must be a uuid" });
    return;
  }

  const beforeId = req.body?.beforeId ?? null;
  const afterId = req.body?.afterId ?? null;
  if ((beforeId !== null && !isUuid(beforeId)) || (afterId !== null && !isUuid(afterId))) {
    res.status(400).json({ error: "beforeId and afterId must each be a uuid or null" });
    return;
  }

  if (beforeId === stopId || afterId === stopId) {
    res.status(400).json({ error: "A stop cannot be its own neighbour" });
    return;
  }

  const [stop] = await db.select().from(stops).where(eq(stops.id, stopId));
  if (!stop) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }

  // null id -> null rank (top or bottom of the list). A non-null id that isn't in this
  // trip returns undefined, which we treat as a 404 rather than silently ignoring.
  async function rankOf(id: string | null): Promise<string | null | undefined> {
    if (id === null) return null;
    const [row] = await db
      .select({ rank: stops.rank })
      .from(stops)
      .where(and(eq(stops.id, id), eq(stops.tripId, stop.tripId)));
    return row?.rank;
  }

  const beforeRank = await rankOf(beforeId);
  const afterRank = await rankOf(afterId);
  if (beforeRank === undefined || afterRank === undefined) {
    res.status(404).json({ error: "Neighbour stop not found in this trip" });
    return;
  }

  // fractional-indexing v4 silently SWAPS out-of-order arguments rather than throwing,
  // so the bad-ordering check has to happen here or a caller would get a successful
  // move to a position it never asked for.
  if (beforeRank !== null && afterRank !== null && beforeRank >= afterRank) {
    res.status(400).json({ error: "beforeId and afterId are not in ascending order" });
    return;
  }

  let rank: string;
  try {
    rank = generateKeyBetween(beforeRank, afterRank);
  } catch {
    // Still reachable: identical ranks, or a rank string the library rejects.
    res.status(400).json({ error: "Could not compute a rank between those neighbours" });
    return;
  }

  const [updated] = await db
    .update(stops)
    .set({ rank, updatedAt: new Date() })
    .where(eq(stops.id, stopId))
    .returning();

  res.json(updated);
});
