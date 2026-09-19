import { integer, pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const otpChallengesTable = pgTable(
  "otp_challenges",
  {
    id: serial("id").primaryKey(),
    phoneNormalized: text("phone_normalized").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("otp_challenges_phone_normalized_idx").on(table.phoneNormalized)],
);

export type OtpChallenge = typeof otpChallengesTable.$inferSelect;
