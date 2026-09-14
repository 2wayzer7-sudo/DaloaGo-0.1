import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const tripsTable = pgTable("trips", {
  id: serial("id").primaryKey(),
  passengerName: text("passenger_name").notNull(),
  passengerPhone: text("passenger_phone"),
  pickup: text("pickup").notNull(),
  destination: text("destination").notNull(),
  status: text("status").notNull().default("requested"),
  fare: real("fare").notNull(),
  initialFare: real("initial_fare").notNull().default(0),
  distanceKm: real("distance_km").notNull(),
  durationMin: integer("duration_min").notNull(),
  pickupLatitude: real("pickup_latitude").notNull().default(6.877),
  pickupLongitude: real("pickup_longitude").notNull().default(-6.45),
  destinationLatitude: real("destination_latitude"),
  destinationLongitude: real("destination_longitude"),
  driverId: integer("driver_id"),
  driverName: text("driver_name"),
  vehicle: text("vehicle"),
  dispatchStage: integer("dispatch_stage").notNull().default(0),
  dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }).notNull().defaultNow(),
  fareIncreaseCount: integer("fare_increase_count").notNull().default(0),
  fareProposalCount: integer("fare_proposal_count").notNull().default(0),
  fareProposalStatus: text("fare_proposal_status").notNull().default("none"),
  fareProposalAmount: real("fare_proposal_amount"),
  fareProposalAt: timestamp("fare_proposal_at", { withTimezone: true }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
});

export type Trip = typeof tripsTable.$inferSelect;