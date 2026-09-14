import { integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const tripEventsTable = pgTable(
  "trip_events",
  {
    id: serial("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    tripId: integer("trip_id").notNull(),
    type: text("type").notNull(),
    dispatchAttemptId: integer("dispatch_attempt_id"),
    driverId: integer("driver_id"),
    stage: integer("stage"),
    distanceKm: real("distance_km"),
    etaMin: integer("eta_min"),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventKeyUnique: uniqueIndex("trip_events_event_key_unique").on(table.eventKey),
  }),
);

export type TripEvent = typeof tripEventsTable.$inferSelect;