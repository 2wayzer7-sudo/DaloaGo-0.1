import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const driversTable = pgTable("drivers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  vehicle: text("vehicle").notNull(),
  plate: text("plate").notNull(),
  rating: real("rating").notNull().default(5),
  status: text("status").notNull().default("available"),
  tripsToday: integer("trips_today").notNull().default(0),
  latitude: real("latitude").notNull().default(6.877),
  longitude: real("longitude").notNull().default(-6.45),
  lastLocationAt: timestamp("last_location_at", { withTimezone: true }).notNull().defaultNow(),
  capacity: integer("capacity").notNull().default(4),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Driver = typeof driversTable.$inferSelect;