import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const tripAnalyticsTable = pgTable("trip_analytics", {
  tripId: integer("trip_id").primaryKey(),
  pickupZoneId: integer("pickup_zone_id"),
  destinationZoneId: integer("destination_zone_id"),
  availableDriversAtRequest: integer("available_drivers_at_request").notNull().default(0),
  proposedDriverDistanceKm: real("proposed_driver_distance_km"),
  proposedDriverEtaMin: integer("proposed_driver_eta_min"),
  driverFoundAt: timestamp("driver_found_at", { withTimezone: true }),
  searchDurationSec: integer("search_duration_sec"),
  approachStartedAt: timestamp("approach_started_at", { withTimezone: true }),
  tripStartedAt: timestamp("trip_started_at", { withTimezone: true }),
  approachDurationSec: integer("approach_duration_sec"),
  actualDistanceKm: real("actual_distance_km"),
  actualDurationSec: integer("actual_duration_sec"),
  acceptedFare: real("accepted_fare"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TripAnalytics = typeof tripAnalyticsTable.$inferSelect;