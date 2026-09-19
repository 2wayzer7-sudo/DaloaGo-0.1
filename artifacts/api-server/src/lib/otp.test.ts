import assert from "node:assert/strict";
import { test } from "node:test";
import { createOtpService, generateOtpCode, hashOtpCode, OTP_MAX_ATTEMPTS, type OtpChallengeCreateInput, type OtpChallengeRecord, type OtpChallengeStore } from "./otp.js";
import { normalizePhoneNumber } from "./phone.js";

const PHONE = "+2250708091011";
const NOW = new Date("2026-01-01T00:00:00.000Z");

class MemoryOtpStore implements OtpChallengeStore {
  challenges: OtpChallengeRecord[] = [];
  private nextId = 1;

  async withTransaction<T>(callback: (store: OtpChallengeStore) => Promise<T>): Promise<T> { return callback(this); }

  async countRecent(phoneNormalized: string, since: Date, limit: number): Promise<number> {
    return this.challenges.filter((challenge) => challenge.phoneNormalized === phoneNormalized && challenge.createdAt > since).slice(0, limit).length;
  }

  async revokeActive(phoneNormalized: string, now: Date): Promise<void> {
    for (const challenge of this.challenges) {
      if (challenge.phoneNormalized === phoneNormalized && challenge.consumedAt === null && challenge.revokedAt === null && challenge.expiresAt > now) challenge.revokedAt = now;
    }
  }

  async createChallenge(input: OtpChallengeCreateInput): Promise<OtpChallengeRecord> {
    const challenge: OtpChallengeRecord = { id: this.nextId++, ...input, attempts: 0, consumedAt: null, revokedAt: null, createdAt: NOW };
    this.challenges.push(challenge);
    return challenge;
  }

  async findLatestValid(phoneNormalized: string, now: Date): Promise<OtpChallengeRecord | undefined> {
    return [...this.challenges].filter((challenge) => challenge.phoneNormalized === phoneNormalized && challenge.consumedAt === null && challenge.revokedAt === null && challenge.expiresAt > now).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  async recordFailedAttempt(id: number, attempts: number, now: Date, maxAttempts: number): Promise<boolean> {
    const challenge = this.challenges.find((candidate) => candidate.id === id);
    if (!challenge || challenge.attempts !== attempts || challenge.consumedAt || challenge.revokedAt) return false;
    challenge.attempts += 1;
    if (challenge.attempts >= maxAttempts) challenge.revokedAt = now;
    return true;
  }

  async consume(id: number, now: Date): Promise<boolean> {
    const challenge = this.challenges.find((candidate) => candidate.id === id);
    if (!challenge || challenge.consumedAt || challenge.revokedAt || challenge.expiresAt <= now) return false;
    challenge.consumedAt = now;
    return true;
  }
}

function setup() {
  const store = new MemoryOtpStore();
  return { store, service: createOtpService(store) };
}

test("A. normalise un numéro E.164 valide", () => assert.equal(normalizePhoneNumber("+225 07 08 09 10 11"), PHONE));
test("B. refuse un numéro invalide", () => assert.throws(() => normalizePhoneNumber("0708091011"), /Invalid phone number/));
test("C. génère des codes de six chiffres avec une source sûre", () => {
  const codes = new Set(Array.from({ length: 64 }, () => generateOtpCode()));
  assert.ok([...codes].every((code) => /^\d{6}$/.test(code)));
  assert.ok(codes.size > 1);
});
test("D. ne stocke que le hash", async () => {
  const { store, service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  const challenge = store.challenges[0];
  assert.ok(challenge);
  assert.equal(challenge.codeHash, hashOtpCode(result.code));
  assert.notEqual(challenge.codeHash, result.code);
  assert.equal("code" in challenge, false);
});
test("E. accepte le bon OTP", async () => {
  const { service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  assert.deepEqual(await service.verifyOtp(PHONE, result.code, NOW), { accepted: true, reason: "accepted" });
});
test("F. refuse un OTP incorrect", async () => {
  const { service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  const wrongCode = result.code === "000000" ? "111111" : "000000";
  assert.equal((await service.verifyOtp(PHONE, wrongCode, NOW)).accepted, false);
});
test("G. incrémente attempts après un échec", async () => {
  const { store, service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  await service.verifyOtp(PHONE, result.code === "000000" ? "111111" : "000000", NOW);
  assert.equal(store.challenges[0]?.attempts, 1);
});
test("H. respecte le nombre maximal d’essais", async () => {
  const { store, service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  const wrongCode = result.code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) await service.verifyOtp(PHONE, wrongCode, NOW);
  assert.equal(store.challenges[0]?.attempts, OTP_MAX_ATTEMPTS);
  assert.equal((await service.verifyOtp(PHONE, result.code, NOW)).accepted, false);
});
test("I. refuse un OTP expiré", async () => {
  const { service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  assert.equal((await service.verifyOtp(PHONE, result.code, new Date(result.expiresAt.getTime() + 1))).accepted, false);
});
test("J. refuse un OTP consommé", async () => {
  const { store, service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  store.challenges[0]!.consumedAt = NOW;
  assert.equal((await service.verifyOtp(PHONE, result.code, NOW)).accepted, false);
});
test("K. refuse un OTP révoqué", async () => {
  const { store, service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  store.challenges[0]!.revokedAt = NOW;
  assert.equal((await service.verifyOtp(PHONE, result.code, NOW)).accepted, false);
});
test("L. révoque l’ancien défi lors d’une nouvelle demande", async () => {
  const { store, service } = setup();
  await service.requestOtp(PHONE, NOW);
  await service.requestOtp(PHONE, new Date(NOW.getTime() + 1000));
  assert.ok(store.challenges[0]?.revokedAt);
  assert.equal(store.challenges[1]?.revokedAt, null);
});
test("M. empêche la réutilisation après réussite", async () => {
  const { service } = setup();
  const result = await service.requestOtp(PHONE, NOW);
  assert.equal((await service.verifyOtp(PHONE, result.code, NOW)).accepted, true);
  assert.equal((await service.verifyOtp(PHONE, result.code, NOW)).accepted, false);
});
