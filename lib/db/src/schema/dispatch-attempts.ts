import { integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const dispatchAttemptsTable = pgTable(
  "dispatch_attempts",
  {
    id: serial("id").primaryKey(),
    tripId: integer("trip_id").notNull(),
    driverId: integer("driver_id").notNull(),
    stage: integer("stage").notNull(),
    status: text("status").notNull().default("offered"),
    distanceKm: real("distance_km").notNull(),
    etaMin: integer("eta_min").notNull(),
    offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => ({
    tripDriverStageUnique: uniqueIndex("dispatch_attempts_trip_driver_stage_idx").on(
      table.tripId,
      table.driverId,
      table.stage,
    ),
  }),
);

export type DispatchAttempt = typeof dispatchAttemptsTable.$inferSelect;