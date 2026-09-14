import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  dispatchAttemptsTable,
  driversTable,
  tripAnalyticsTable,
  tripEventsTable,
  tripsTable,
  virtualZonesTable,
  type Trip,
  type VirtualZone,
} from "@workspace/db/schema";
import { logger } from "./logger";

const EARTH_RADIUS_KM = 6371;

function distanceKm(
  latitude: number,
  longitude: number,
  otherLatitude: number,
  otherLongitude: number,
) {
  const lat1 = latitude * Math.PI / 180;
  const lat2 = otherLatitude * Math.PI / 180;
  const deltaLat = (otherLatitude - latitude) * Math.PI / 180;
  const deltaLng = (otherLongitude - longitude) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findZoneForPoint(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  zones: VirtualZone[],
) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return undefined;
  }

  return zones
    .filter((zone) => distanceKm(latitude, longitude, zone.centerLatitude, zone.centerLongitude) <= zone.radiusKm)
    .sort((left, right) => distanceKm(latitude, longitude, left.centerLatitude, left.centerLongitude)
      - distanceKm(latitude, longitude, right.centerLatitude, right.centerLongitude))[0];
}

function secondsBetween(start: Date | null | undefined, end: Date) {
  if (!start) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

export async function recordTripEvent(input: {
  eventKey: string;
  tripId: number;
  type: string;
  dispatchAttemptId?: number | null;
  driverId?: number | null;
  stage?: number | null;
  distanceKm?: number | null;
  etaMin?: number | null;
  reason?: string | null;
  occurredAt?: Date;
}) {
  await db
    .insert(tripEventsTable)
    .values({
      eventKey: input.eventKey,
      tripId: input.tripId,
      type: input.type,
      dispatchAttemptId: input.dispatchAttemptId ?? null,
      driverId: input.driverId ?? null,
      stage: input.stage ?? null,
      distanceKm: input.distanceKm ?? null,
      etaMin: input.etaMin ?? null,
      reason: input.reason ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: tripEventsTable.eventKey });
}

export async function ensureTripAnalytics(trip: Trip) {
  const zones = await db.select().from(virtualZonesTable).where(eq(virtualZonesTable.active, true));
  const availableDrivers = await db
    .select({ id: driversTable.id })
    .from(driversTable)
    .where(eq(driversTable.status, "available"));
  const existing = await db
    .select()
    .from(tripAnalyticsTable)
    .where(eq(tripAnalyticsTable.tripId, trip.id));
  const pickupZone = findZoneForPoint(trip.pickupLatitude, trip.pickupLongitude, zones);
  const destinationZone = findZoneForPoint(trip.destinationLatitude, trip.destinationLongitude, zones);

  if (existing.length === 0) {
    await db.insert(tripAnalyticsTable).values({
      tripId: trip.id,
      pickupZoneId: pickupZone?.id ?? null,
      destinationZoneId: destinationZone?.id ?? null,
      availableDriversAtRequest: availableDrivers.length,
      acceptedFare: trip.driverId ? trip.fare : null,
    });
    return;
  }

  const current = existing[0]!;
  const patch: Partial<typeof tripAnalyticsTable.$inferInsert> = {};
  if (current.pickupZoneId === null && pickupZone) patch.pickupZoneId = pickupZone.id;
  if (current.destinationZoneId === null && destinationZone) patch.destinationZoneId = destinationZone.id;
  if (current.acceptedFare === null && trip.driverId) patch.acceptedFare = trip.fare;
  if (Object.keys(patch).length > 0) {
    await db.update(tripAnalyticsTable).set(patch).where(eq(tripAnalyticsTable.tripId, trip.id));
  }
}

export async function recordTripRequest(trip: Trip) {
  await ensureTripAnalytics(trip);
  await recordTripEvent({
    eventKey: `trip:${trip.id}:requested`,
    tripId: trip.id,
    type: "trip_requested",
    occurredAt: trip.requestedAt,
  });
  await recordTripEvent({
    eventKey: `trip:${trip.id}:search_started`,
    tripId: trip.id,
    type: "dispatch_search_started",
    occurredAt: trip.requestedAt,
  });
}

export async function recordTripStatus(input: {
  trip: Trip;
  previousStatus: string;
  reason?: string | null;
  occurredAt?: Date;
}) {
  const occurredAt = input.occurredAt ?? new Date();
  await ensureTripAnalytics(input.trip);
  const current = await db
    .select()
    .from(tripAnalyticsTable)
    .where(eq(tripAnalyticsTable.tripId, input.trip.id));
  const analytics = current[0];
  const patch: Partial<typeof tripAnalyticsTable.$inferInsert> = {};

  if (input.trip.status === "accepted") {
    patch.driverFoundAt = occurredAt;
    patch.searchDurationSec = secondsBetween(input.trip.requestedAt, occurredAt);
    patch.acceptedFare = input.trip.fare;
  } else if (input.trip.status === "arriving") {
    patch.approachStartedAt = occurredAt;
  } else if (input.trip.status === "in_progress") {
    patch.tripStartedAt = occurredAt;
    patch.approachDurationSec = secondsBetween(analytics?.approachStartedAt, occurredAt);
  } else if (input.trip.status === "cancelled") {
    patch.cancellationReason = input.reason ?? "non_precisee";
  } else if (input.trip.status === "completed") {
    patch.acceptedFare = input.trip.fare;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(tripAnalyticsTable).set(patch).where(eq(tripAnalyticsTable.tripId, input.trip.id));
  }

  const type = input.trip.status === "cancelled"
    ? "trip_cancelled"
    : input.trip.status === "completed"
      ? "trip_completed"
      : `trip_${input.trip.status}`;
  await recordTripEvent({
    eventKey: `trip:${input.trip.id}:status:${input.previousStatus}->${input.trip.status}:${occurredAt.toISOString()}`,
    tripId: input.trip.id,
    type,
    reason: input.reason ?? null,
    occurredAt,
  });
}

async function recordDispatchAttemptTelemetry(attempt: typeof dispatchAttemptsTable.$inferSelect, trip: Trip) {
  const typeByStatus: Record<string, string> = {
    offered: "offer_sent",
    rejected: "offer_rejected",
    expired: "offer_expired",
    accepted: "offer_accepted",
    cancelled: "offer_cancelled",
    unavailable: "offer_unavailable",
  };
  const type = typeByStatus[attempt.status];
  if (!type) return;
  const occurredAt = attempt.respondedAt ?? attempt.offeredAt;
  await recordTripEvent({
    eventKey: `dispatch-attempt:${attempt.id}:${type}`,
    tripId: trip.id,
    type,
    dispatchAttemptId: attempt.id,
    driverId: attempt.driverId,
    stage: attempt.stage,
    distanceKm: attempt.distanceKm,
    etaMin: attempt.etaMin,
    occurredAt,
  });

  if (attempt.status === "offered") {
    await db
      .update(tripAnalyticsTable)
      .set({
        proposedDriverDistanceKm: attempt.distanceKm,
        proposedDriverEtaMin: attempt.etaMin,
      })
      .where(and(
        eq(tripAnalyticsTable.tripId, trip.id),
        isNull(tripAnalyticsTable.proposedDriverDistanceKm),
      ));
  }
  if (attempt.status === "accepted") {
    await db
      .update(tripAnalyticsTable)
      .set({
        proposedDriverDistanceKm: attempt.distanceKm,
        proposedDriverEtaMin: attempt.etaMin,
        driverFoundAt: occurredAt,
        searchDurationSec: secondsBetween(trip.requestedAt, occurredAt),
        acceptedFare: trip.fare,
      })
      .where(eq(tripAnalyticsTable.tripId, trip.id));
  }
}

export async function collectTelemetry() {
  const trips = await db.select().from(tripsTable);
  for (const trip of trips) {
    await ensureTripAnalytics(trip);
    await recordTripEvent({
      eventKey: `trip:${trip.id}:requested`,
      tripId: trip.id,
      type: "trip_requested",
      occurredAt: trip.requestedAt,
    });
  }

  const attempts = await db.select().from(dispatchAttemptsTable);
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  for (const attempt of attempts) {
    const trip = tripById.get(attempt.tripId);
    if (trip) await recordDispatchAttemptTelemetry(attempt, trip);
  }
}

let telemetryTimer: NodeJS.Timeout | undefined;

export function startTelemetryWorker() {
  if (telemetryTimer) return;
  const run = () => {
    collectTelemetry().catch((error) => logger.error({ err: error }, "Telemetry collection failed"));
  };
  run();
  telemetryTimer = setInterval(run, 15000);
  telemetryTimer.unref();
  logger.info("Trip telemetry worker started");
}