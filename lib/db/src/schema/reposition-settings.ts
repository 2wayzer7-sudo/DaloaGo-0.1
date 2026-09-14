import { boolean, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const repositionSettingsTable = pgTable("reposition_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(true),
  recommendationDurationMin: integer("recommendation_duration_min").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RepositionSettings = typeof repositionSettingsTable.$inferSelect;