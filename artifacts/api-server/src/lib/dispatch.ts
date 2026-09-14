import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { dispatchAttemptsTable, dispatchSettingsTable, driversTable, tripsTable, type DispatchSettings } from "@workspace/db/schema";
import { logger } from "./logger";

const DALOA_CENTER = { latitude: 6.877, longitude: -6.45 };

export const DEFAULT_DISPATCH_SETTINGS = {
  id: 1,
  searchRadiiKm: [3, 6, 12],
  stageDurationsMin: [5, 5, 5],
  fareIncreaseAfterMin: 10,
  maxFareIncreases: 2,
  fareIncreaseAmounts: [100, 100],
  offerTimeoutSec: 45,
  gpsFreshnessSec: 300,
  averageSpeedKmh: 25,
};

type DispatchResult =
  | { kind: "noop" }
  | { kind: "offer"; attemptId: number; driverId: number; distanceKm: number; etaMin: number }
  | { kind: "fare_proposal"; amount: number };

const inFlightTrips = new Set<number>();
let dispatchTimer: NodeJS.Timeout | undefined;

export async function getDispatchSettings(): Promise<DispatchSettings> {
  const [existing] = await db.select().from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, 1));
  if (existing) return existing;

  await db.insert(dispatchSettingsTable).values(DEFAULT_DISPATCH_SETTINGS).onConflictDoNothing();
  const [created] = await db.select().from(dispatchSettingsTable).where(eq(dispatchSettingsTable.id, 1));
  if (!created) throw new Error("Dispatch settings could not be initialized");
  return created;
}

function haversineKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusKm = 6371;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const latitude1 = (from.latitude * Math.PI) / 180;
  const latitude2 = (to.latitude * Math.PI) / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitude1) * Math.cos(latitude2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDispatchStage(elapsedMinutes: number, settings: DispatchSettings) {
  const lastStage = Math.max(0, settings.searchRadiiKm.length - 1);
  let stageStart = 0;
  for (let stage = 0; stage < lastStage; stage += 1) {
    stageStart += settings.stageDurationsMin[stage] ?? settings.stageDurationsMin.at(-1) ?? 5;
    if (elapsedMinutes < stageStart) return stage;
  }
  return lastStage;
}

function isFreshLocation(lastLocationAt: Date, now: Date, freshnessSec: number) {
  return lastLocationAt.getTime() >= now.getTime() - freshnessSec * 1000;
}

function serializeDistance(distanceKm: number) {
  return Math.round(distanceKm * 10) / 10;
}

export async function advanceDispatch(tripId: number, settings?: DispatchSettings): Promise<DispatchResult> {
  if (inFlightTrips.has(tripId)) return { kind: "noop" };
  inFlightTrips.add(tripId);

  try {
    const dispatchSettings = settings ?? await getDispatchSettings();
    return await db.transaction(async (tx) => {
      const [trip] = await tx
        .select()
        .from(tripsTable)
        .where(eq(tripsTable.id, tripId))
        .for("update");
      if (!trip || trip.status !== "requested") return { kind: "noop" };

      const now = new Date();
      await tx
        .update(dispatchAttemptsTable)
        .set({ status: "expired", respondedAt: now })
        .where(and(
          eq(dispatchAttemptsTable.tripId, tripId),
          eq(dispatchAttemptsTable.status, "offered"),
          lt(dispatchAttemptsTable.expiresAt, now),
        ));

      const [pendingOffer] = await tx
        .select({ id: dispatchAttemptsTable.id })
        .from(dispatchAttemptsTable)
        .where(and(
          eq(dispatchAttemptsTable.tripId, tripId),
          eq(dispatchAttemptsTable.status, "offered"),
          gt(dispatchAttemptsTable.expiresAt, now),
        ))
        .limit(1);
      if (pendingOffer) return { kind: "noop" };

      const elapsedMinutes = Math.max(0, (now.getTime() - trip.dispatchStartedAt.getTime()) / 60000);
      const stage = getDispatchStage(elapsedMinutes, dispatchSettings);
      if (stage !== trip.dispatchStage) {
        await tx.update(tripsTable).set({ dispatchStage: stage }).where(eq(tripsTable.id, tripId));
      }

      const attemptedRows = await tx
        .select({ driverId: dispatchAttemptsTable.driverId })
        .from(dispatchAttemptsTable)
        .where(and(eq(dispatchAttemptsTable.tripId, tripId), eq(dispatchAttemptsTable.stage, stage)));
      const pendingDriverRows = await tx
        .select({ driverId: dispatchAttemptsTable.driverId })
        .from(dispatchAttemptsTable)
        .where(eq(dispatchAttemptsTable.status, "offered"));
      const availableDrivers = await tx.select().from(driversTable).where(eq(driversTable.status, "available"));
      const attemptedDriverIds = new Set(attemptedRows.map((row) => row.driverId));
      const pendingDriverIds = new Set(pendingDriverRows.map((row) => row.driverId));
      const radiusKm = dispatchSettings.searchRadiiKm[Math.min(stage, dispatchSettings.searchRadiiKm.length - 1)]
        ?? dispatchSettings.searchRadiiKm.at(-1)
        ?? 0;
      const pickup = {
        latitude: trip.pickupLatitude ?? DALOA_CENTER.latitude,
        longitude: trip.pickupLongitude ?? DALOA_CENTER.longitude,
      };

      const candidates = availableDrivers
        .filter((driver) => driver.capacity > 0)
        .filter((driver) => isFreshLocation(driver.lastLocationAt, now, dispatchSettings.gpsFreshnessSec))
        .filter((driver) => !attemptedDriverIds.has(driver.id) && !pendingDriverIds.has(driver.id))
        .map((driver) => {
          const distanceKm = haversineKm(pickup, { latitude: driver.latitude, longitude: driver.longitude });
          const etaMin = Math.max(1, Math.round((distanceKm / dispatchSettings.averageSpeedKmh) * 60));
          const freshnessSec = Math.max(0, (now.getTime() - driver.lastLocationAt.getTime()) / 1000);
          return { driver, distanceKm, etaMin, freshnessSec };
        })
        .filter((candidate) => candidate.distanceKm <= radiusKm)
        .sort((a, b) => (
          a.distanceKm - b.distanceKm
          || a.etaMin - b.etaMin
          || a.freshnessSec - b.freshnessSec
          || b.driver.capacity - a.driver.capacity
        ));

      for (const candidate of candidates) {
        const [lockedDriver] = await tx
          .select()
          .from(driversTable)
          .where(eq(driversTable.id, candidate.driver.id))
          .for("update");
        if (!lockedDriver || lockedDriver.status !== "available" || lockedDriver.capacity <= 0) continue;
        const [lockedPendingOffer] = await tx
          .select({ id: dispatchAttemptsTable.id })
          .from(dispatchAttemptsTable)
          .where(and(
            eq(dispatchAttemptsTable.driverId, lockedDriver.id),
            eq(dispatchAttemptsTable.status, "offered"),
            gt(dispatchAttemptsTable.expiresAt, now),
          ))
          .limit(1);
        if (lockedPendingOffer) continue;

        const expiresAt = new Date(now.getTime() + dispatchSettings.offerTimeoutSec * 1000);
        const [attempt] = await tx.insert(dispatchAttemptsTable).values({
          tripId,
          driverId: lockedDriver.id,
          stage,
          status: "offered",
          distanceKm: serializeDistance(candidate.distanceKm),
          etaMin: candidate.etaMin,
          offeredAt: now,
          expiresAt,
        }).returning({ id: dispatchAttemptsTable.id });
        if (!attempt) throw new Error("Dispatch offer could not be created");
        return {
          kind: "offer",
          attemptId: attempt.id,
          driverId: lockedDriver.id,
          distanceKm: serializeDistance(candidate.distanceKm),
          etaMin: candidate.etaMin,
        };
      }

      const nextProposalAtMinute = dispatchSettings.fareIncreaseAfterMin * (trip.fareIncreaseCount + 1);
      const canProposeFare = elapsedMinutes >= nextProposalAtMinute
        && trip.fareProposalStatus !== "pending"
        && trip.fareProposalStatus !== "rejected"
        && trip.fareIncreaseCount < dispatchSettings.maxFareIncreases
        && trip.fareProposalCount < dispatchSettings.maxFareIncreases;
      const amount = dispatchSettings.fareIncreaseAmounts[trip.fareProposalCount];
      if (canProposeFare && amount !== undefined && amount > 0) {
        await tx.update(tripsTable).set({
          fareProposalStatus: "pending",
          fareProposalAmount: amount,
          fareProposalAt: now,
          fareProposalCount: trip.fareProposalCount + 1,
        }).where(eq(tripsTable.id, tripId));
        return { kind: "fare_proposal", amount };
      }

      return { kind: "noop" };
    });
  } finally {
    inFlightTrips.delete(tripId);
  }
}

export async function runDispatchSweep() {
  const settings = await getDispatchSettings();
  const activeTrips = await db
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(eq(tripsTable.status, "requested"));

  await Promise.all(activeTrips.map(async ({ id }) => {
    try {
      await advanceDispatch(id, settings);
    } catch (error) {
      logger.error({ err: error, tripId: id }, "Dispatch sweep failed");
    }
  }));
}

export function startDispatchWorker() {
  if (dispatchTimer) return;
  dispatchTimer = setInterval(() => {
    void runDispatchSweep();
  }, 15000);
  dispatchTimer.unref();
  void runDispatchSweep();
  logger.info("Dispatch worker started");
}