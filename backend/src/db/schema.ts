import { doublePrecision, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stops = pgTable(
  "stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    // Milestone 3 (maps/geocoding) fills these in. Nothing in milestone 2 writes them.
    address: text("address"),
    placeId: text("place_id"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    // Fractional index. Ordering is always ORDER BY rank ASC, compared as text.
    // Inserting between two stops means minting a new key between their two ranks,
    // so only the moved row is ever written.
    rank: text("rank").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stops_trip_id_rank_idx").on(table.tripId, table.rank)],
);

export type Trip = typeof trips.$inferSelect;
export type Stop = typeof stops.$inferSelect;
