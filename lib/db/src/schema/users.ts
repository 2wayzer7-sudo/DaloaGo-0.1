import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { driversTable } from "./drivers";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  phoneNormalized: text("phone_normalized").notNull().unique(),
  role: text("role").notNull(),
  driverId: integer("driver_id").references(() => driversTable.id).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
