import { boolean, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const demandForecastSettingsTable = pgTable("demand_forecast_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(true),
  minimumDataPoints: integer("minimum_data_points").notNull().default(12),
  forecastHorizonHours: integer("forecast_horizon_hours").notNull().default(2),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DemandForecastSettings = typeof demandForecastSettingsTable.$inferSelect;