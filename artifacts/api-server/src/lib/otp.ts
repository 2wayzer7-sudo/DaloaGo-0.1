import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { normalizePhoneNumber } from "./phone.js";

export { normalizePhoneNumber } from "./phone.js";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const OTP_MAX_REQUESTS_PER_WINDOW = 3;

export type OtpChallengeRecord = {
  id: number;
  phoneNormalized: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type OtpChallengeCreateInput = Pick<OtpChallengeRecord, "phoneNormalized" | "codeHash" | "expiresAt">;

export interface OtpChallengeStore {
  withTransaction<T>(callback: (store: OtpChallengeStore) => Promise<T>): Promise<T>;
  countRecent(phoneNormalized: string, since: Date, limit: number): Promise<number>;
  revokeActive(phoneNormalized: string, now: Date): Promise<void>;
  createChallenge(input: OtpChallengeCreateInput): Promise<OtpChallengeRecord>;
  findLatestValid(phoneNormalized: string, now: Date): Promise<OtpChallengeRecord | undefined>;
  recordFailedAttempt(id: number, attempts: number, now: Date, maxAttempts: number): Promise<boolean>;
  consume(id: number, now: Date): Promise<boolean>;
}

export type OtpRequestResult = {
  challengeId: number;
  phoneNormalized: string;
  code: string;
  expiresAt: Date;
};

export type OtpVerificationResult = {
  accepted: boolean;
  reason: "accepted" | "invalid_code" | "invalid_challenge" | "too_many_attempts";
};

export class OtpRateLimitError extends Error {
  constructor() {
    super("Too many OTP requests");
    this.name = "OtpRateLimitError";
  }
}

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function hashesMatch(code: string, codeHash: string): boolean {
  const expected = Buffer.from(hashOtpCode(code), "hex");
  const actual = Buffer.from(codeHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createOtpService(store: OtpChallengeStore) {
  return {
    async requestOtp(phone: string, now = new Date()): Promise<OtpRequestResult> {
      const phoneNormalized = normalizePhoneNumber(phone);

      return store.withTransaction(async (transaction) => {
        const since = new Date(now.getTime() - OTP_RATE_LIMIT_WINDOW_MS);
        const recentRequests = await transaction.countRecent(phoneNormalized, since, OTP_MAX_REQUESTS_PER_WINDOW);
        if (recentRequests >= OTP_MAX_REQUESTS_PER_WINDOW) {
          throw new OtpRateLimitError();
        }

        const code = generateOtpCode();
        const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
        await transaction.revokeActive(phoneNormalized, now);
        const challenge = await transaction.createChallenge({ phoneNormalized, codeHash: hashOtpCode(code), expiresAt });

        return { challengeId: challenge.id, phoneNormalized, code, expiresAt };
      });
    },

    async verifyOtp(phone: string, code: string, now = new Date()): Promise<OtpVerificationResult> {
      const phoneNormalized = normalizePhoneNumber(phone);
      if (!/^\d{6}$/.test(code)) return { accepted: false, reason: "invalid_code" };

      return store.withTransaction(async (transaction) => {
        const challenge = await transaction.findLatestValid(phoneNormalized, now);
        if (!challenge) return { accepted: false, reason: "invalid_challenge" };
        if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { accepted: false, reason: "too_many_attempts" };

        if (hashesMatch(code, challenge.codeHash)) {
          const consumed = await transaction.consume(challenge.id, now);
          return consumed ? { accepted: true, reason: "accepted" } : { accepted: false, reason: "invalid_challenge" };
        }

        const nextAttempts = challenge.attempts + 1;
        const updated = await transaction.recordFailedAttempt(challenge.id, challenge.attempts, now, OTP_MAX_ATTEMPTS);
        if (!updated) return { accepted: false, reason: "invalid_challenge" };
        return { accepted: false, reason: nextAttempts >= OTP_MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code" };
      });
    },
  };
}
