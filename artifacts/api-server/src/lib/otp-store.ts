import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { otpChallengesTable } from "@workspace/db/schema";
import type { OtpChallengeCreateInput, OtpChallengeRecord, OtpChallengeStore } from "./otp.js";

type QueryExecutor = any;

function createStore(executor: QueryExecutor, root: boolean): OtpChallengeStore {
  const store: OtpChallengeStore = {
    async withTransaction<T>(callback) {
      if (!root) return callback(store);
      return db.transaction(async (transaction) => callback(createStore(transaction, false)));
    },

    async countRecent(phoneNormalized, since, limit) {
      const rows = await executor.select({ id: otpChallengesTable.id }).from(otpChallengesTable).where(
        and(eq(otpChallengesTable.phoneNormalized, phoneNormalized), gt(otpChallengesTable.createdAt, since)),
      ).limit(limit);
      return rows.length;
    },

    async revokeActive(phoneNormalized, now) {
      await executor.update(otpChallengesTable).set({ revokedAt: now }).where(
        and(
          eq(otpChallengesTable.phoneNormalized, phoneNormalized),
          isNull(otpChallengesTable.consumedAt),
          isNull(otpChallengesTable.revokedAt),
          gt(otpChallengesTable.expiresAt, now),
        ),
      );
    },

    async createChallenge(input: OtpChallengeCreateInput) {
      const [created] = await executor.insert(otpChallengesTable).values({ ...input, attempts: 0 }).returning();
      if (!created) throw new Error("OTP challenge could not be created");
      return created as OtpChallengeRecord;
    },

    async findLatestValid(phoneNormalized, now) {
      const [challenge] = await executor.select().from(otpChallengesTable).where(
        and(
          eq(otpChallengesTable.phoneNormalized, phoneNormalized),
          isNull(otpChallengesTable.consumedAt),
          isNull(otpChallengesTable.revokedAt),
          gt(otpChallengesTable.expiresAt, now),
        ),
      ).orderBy(desc(otpChallengesTable.createdAt)).limit(1);
      return challenge as OtpChallengeRecord | undefined;
    },

    async recordFailedAttempt(id, attempts, now, maxAttempts) {
      const nextAttempts = attempts + 1;
      const [updated] = await executor.update(otpChallengesTable).set({
        attempts: nextAttempts,
        ...(nextAttempts >= maxAttempts ? { revokedAt: now } : {}),
      }).where(
        and(eq(otpChallengesTable.id, id), isNull(otpChallengesTable.consumedAt), isNull(otpChallengesTable.revokedAt)),
      ).returning({ id: otpChallengesTable.id });
      return Boolean(updated);
    },

    async consume(id, now) {
      const [consumed] = await executor.update(otpChallengesTable).set({ consumedAt: now }).where(
        and(
          eq(otpChallengesTable.id, id),
          isNull(otpChallengesTable.consumedAt),
          isNull(otpChallengesTable.revokedAt),
          gt(otpChallengesTable.expiresAt, now),
        ),
      ).returning({ id: otpChallengesTable.id });
      return Boolean(consumed);
    },
  };
  return store;
}

export const otpChallengeStore = createStore(db, true);
