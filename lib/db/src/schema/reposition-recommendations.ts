import { integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const repositionRecommendationsTable = pgTable(
  "reposition_recommendations",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull(),
    driverId: integer("driver_id").notNull(),
    zoneId: integer("zone_id").notNull(),
    demandLevel: text("demand_level").notNull(),
    demandsPerHour: real("demands_per_hour").notNull(),
    availableDrivers: integer("available_drivers").notNull(),
    distanceToZoneKm: real("distance_to_zone_km").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => ({
    tripDriverUnique: uniqueIndex("reposition_recommendations_trip_driver_unique").on(table.tripId, table.driverId),
  }),
);

export type RepositionRecommendation = typeof repositionRecommendationsTable.$inferSelect;