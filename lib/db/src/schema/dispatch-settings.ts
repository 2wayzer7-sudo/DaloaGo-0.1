import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const dispatchSettingsTable = pgTable("dispatch_settings", {
  id: integer("id").primaryKey().default(1),
  searchRadiiKm: jsonb("search_radii_km").$type<number[]>().notNull().default([3, 6, 12]),
  stageDurationsMin: jsonb("stage_durations_min").$type<number[]>().notNull().default([5, 5, 5]),
  fareIncreaseAfterMin: integer("fare_increase_after_min").notNull().default(10),
  maxFareIncreases: integer("max_fare_increases").notNull().default(2),
  fareIncreaseAmounts: jsonb("fare_increase_amounts").$type<number[]>().notNull().default([100, 100]),
  offerTimeoutSec: integer("offer_timeout_sec").notNull().default(45),
  gpsFreshnessSec: integer("gps_freshness_sec").notNull().default(300),
  averageSpeedKmh: integer("average_speed_kmh").notNull().default(25),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DispatchSettings = typeof dispatchSettingsTable.$inferSelect;