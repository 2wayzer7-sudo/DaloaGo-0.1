import { boolean, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const virtualZonesTable = pgTable("virtual_zones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  centerLatitude: real("center_latitude").notNull(),
  centerLongitude: real("center_longitude").notNull(),
  radiusKm: real("radius_km").notNull().default(1),
  lowDemandPerHour: real("low_demand_per_hour").notNull().default(1),
  highDemandPerHour: real("high_demand_per_hour").notNull().default(3),
  minSampleSize: integer("min_sample_size").notNull().default(3),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type VirtualZone = typeof virtualZonesTable.$inferSelect;