import { and, desc, eq, gt, gte, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  driversTable,
  repositionRecommendationsTable,
  repositionSettingsTable,
  tripAnalyticsTable,
  tripsTable,
  virtualZonesTable,
  type RepositionRecommendation,
  type VirtualZone,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { buildDemandForecast } from "./demand-forecast";
import { findZoneForPoint, recordTripEvent } from "./telemetry";

const HISTORY_HOURS = 24;
const DRIVER_ZONE_COOLDOWN_HOURS = 6;
const MAX_NEARBY_DISTANCE_KM = 8;
const GPS_FRESHNESS_MS = 5 * 60 * 1000;

export const repositionDecisionValues = ["accept", "ignore", "dismiss"] as const;
export type RepositionDecision = (typeof repositionDecisionValues)[number];

export async function getRepositionSettings() {
  const [existing] = await db.select().from(repositionSettingsTable).where(eq(repositionSettingsTable.id, 1));
  if (existing) return existing;
  const [created] = await db.insert(repositionSettingsTable).values({ id: 1 }).returning();
  return created;
}

function haversineDistanceKm(
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
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function isSupplyInsufficient(estimatedNeed: number, presentDrivers: number) {
  return estimatedNeed > presentDrivers;
}

async function getRecommendationWithZone(recommendationId: number) {
  const [result] = await db
    .select({ recommendation: repositionRecommendationsTable, zone: virtualZonesTable })
    .from(repositionRecommendationsTable)
    .innerJoin(virtualZonesTable, eq(virtualZonesTable.id, repositionRecommendationsTable.zoneId))
    .where(eq(repositionRecommendationsTable.id, recommendationId));
  if (!result) return undefined;
  return serializeRecommendation(result.recommendation, result.zone);
}

function serializeRecommendation(recommendation: RepositionRecommendation, zone: VirtualZone) {
  return {
    ...recommendation,
    zoneName: zone.name,
  };
}

export async function getPendingRepositionRecommendation(driverId: number) {
  const now = new Date();
  const pending = await db
    .select({ recommendation: repositionRecommendationsTable, zone: virtualZonesTable })
    .from(repositionRecommendationsTable)
    .innerJoin(virtualZonesTable, eq(virtualZonesTable.id, repositionRecommendationsTable.zoneId))
    .where(and(
      eq(repositionRecommendationsTable.driverId, driverId),
      eq(repositionRecommendationsTable.status, "pending"),
      gt(repositionRecommendationsTable.expiresAt, now),
    ))
    .orderBy(desc(repositionRecommendationsTable.createdAt))
    .limit(1);
  const current = pending[0];
  return current ? serializeRecommendation(current.recommendation, current.zone) : null;
}

export async function expireRepositionRecommendation(recommendationId: number, now = new Date()) {
  const [updated] = await db
    .update(repositionRecommendationsTable)
    .set({ status: "expired", respondedAt: now })
    .where(and(
      eq(repositionRecommendationsTable.id, recommendationId),
      eq(repositionRecommendationsTable.status, "pending"),
      lt(repositionRecommendationsTable.expiresAt, now),
    ))
    .returning();
  if (updated) {
    await recordTripEvent({
      eventKey: `reposition:${updated.id}:expired`,
      tripId: updated.tripId,
      type: "reposition_recommendation_expired",
      driverId: updated.driverId,
      reason: "recommendation_expired",
      occurredAt: now,
    });
  }
  return updated;
}

export async function generateRepositionRecommendation(input: { tripId: number; driverId: number }) {
  const settings = await getRepositionSettings();
  if (!settings.enabled) return null;

  const [driver] = await db.select().from(driversTable).where(eq(driversTable.id, input.driverId));
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, input.tripId));
  if (
    !driver
    || !trip
    || trip.status !== "completed"
    || trip.driverId !== input.driverId
    || driver.latitude === null
    || driver.longitude === null
    || Date.now() - driver.lastLocationAt.getTime() > GPS_FRESHNESS_MS
  ) {
    return null;
  }

  const now = new Date();
  const from = new Date(now.getTime() - HISTORY_HOURS * 60 * 60 * 1000);
  const zones = await db
    .select()
    .from(virtualZonesTable)
    .where(eq(virtualZonesTable.active, true));
  if (zones.length === 0) return null;

  const recentDemand = await db
    .select({ trip: tripsTable, analytics: tripAnalyticsTable })
    .from(tripsTable)
    .innerJoin(tripAnalyticsTable, eq(tripAnalyticsTable.tripId, tripsTable.id))
    .where(gte(tripsTable.requestedAt, from));
  const fleet = await db.select().from(driversTable);
  const availableDrivers = fleet.filter((driver) => driver.status === "available");
  const activeDrivers = fleet.filter((driver) => driver.status === "on_trip");
  const recentRecommendations = await db
    .select()
    .from(repositionRecommendationsTable)
    .where(gte(repositionRecommendationsTable.createdAt, new Date(now.getTime() - DRIVER_ZONE_COOLDOWN_HOURS * 60 * 60 * 1000)));
  const forecast = await buildDemandForecast(now);
  const forecastByZone = new Map(forecast.zones.map((zone) => [zone.zoneId, zone]));
  const activeRecommendations = recentRecommendations.filter((recommendation) =>
    (recommendation.status === "pending" || recommendation.status === "accepted")
    && recommendation.expiresAt > now,
  );
  const recentDriverZones = new Set(
    recentRecommendations
      .filter((recommendation) => recommendation.driverId === input.driverId)
      .map((recommendation) => recommendation.zoneId),
  );
  const occupiedZones = new Set(
    activeRecommendations
      .filter((recommendation) => recommendation.driverId !== input.driverId)
      .map((recommendation) => recommendation.zoneId),
  );
  const lastRecommendationByZone = new Map<number, number>();
  for (const recommendation of recentRecommendations) {
    const previous = lastRecommendationByZone.get(recommendation.zoneId) ?? 0;
    lastRecommendationByZone.set(recommendation.zoneId, Math.max(previous, recommendation.createdAt.getTime()));
  }

  const candidates = zones.flatMap((zone) => {
    const distanceToZoneKm = haversineDistanceKm(
      driver.latitude!,
      driver.longitude!,
      zone.centerLatitude,
      zone.centerLongitude,
    );
    const nearbyLimit = Math.max(MAX_NEARBY_DISTANCE_KM, zone.radiusKm * 3);
    if (
      distanceToZoneKm > nearbyLimit
      || recentDriverZones.has(zone.id)
      || occupiedZones.has(zone.id)
    ) {
      return [];
    }

    const demands = recentDemand.filter(({ analytics }) => analytics.pickupZoneId === zone.id);
    const observedDemandsPerHour = round(demands.length / HISTORY_HOURS);
    const zoneForecast = forecastByZone.get(zone.id);
    const forecastDemandPerHour = zoneForecast?.expectedDemandPerHour;
    const forecastAvailable = zoneForecast?.level !== "insufficient"
      && typeof forecastDemandPerHour === "number";
    const demandsPerHour = typeof forecastDemandPerHour === "number"
      ? forecastDemandPerHour
      : observedDemandsPerHour;
    const zoneAvailableDrivers = availableDrivers.filter((availableDriver) =>
      findZoneForPoint(availableDriver.latitude, availableDriver.longitude, [zone])?.id === zone.id,
    );
    const zoneActiveDrivers = activeDrivers.filter((activeDriver) =>
      findZoneForPoint(activeDriver.latitude, activeDriver.longitude, [zone])?.id === zone.id,
    );
    const presentDrivers = zoneAvailableDrivers.length + zoneActiveDrivers.length;
    const supplyInsufficient = forecastAvailable
      ? isSupplyInsufficient(demandsPerHour, presentDrivers)
      : demands.length >= zone.minSampleSize && demandsPerHour >= zone.highDemandPerHour;
    if (!supplyInsufficient) return [];

    return [{
      zone,
      demandsPerHour,
      availableDrivers: zoneAvailableDrivers.length,
      activeDrivers: zoneActiveDrivers.length,
      presentDrivers,
      forecastAvailable,
      distanceToZoneKm: round(distanceToZoneKm),
      lastRecommendationAt: lastRecommendationByZone.get(zone.id) ?? 0,
    }];
  });

  const selected = candidates.sort((left, right) =>
    (right.demandsPerHour - (right.forecastAvailable ? right.presentDrivers : right.availableDrivers))
      - (left.demandsPerHour - (left.forecastAvailable ? left.presentDrivers : left.availableDrivers))
    || left.lastRecommendationAt - right.lastRecommendationAt
    || left.distanceToZoneKm - right.distanceToZoneKm,
  )[0];
  if (!selected) return null;

  const reason = selected.forecastAvailable
    ? `${selected.demandsPerHour} demandes/h estimées dans ${selected.zone.name} (indication probabiliste, non garantie), avec ${selected.availableDrivers} chauffeur(s) disponible(s) et ${selected.activeDrivers} actif(s) dans la zone (${selected.presentDrivers} présents).`
    : `${selected.demandsPerHour} demandes/h estimées dans ${selected.zone.name} (indication probabiliste, non garantie), avec ${selected.availableDrivers} chauffeur(s) disponible(s) dans la zone.`;
  const expiresAt = new Date(now.getTime() + settings.recommendationDurationMin * 60 * 1000);
  const [created] = await db
    .insert(repositionRecommendationsTable)
    .values({
      tripId: input.tripId,
      driverId: input.driverId,
      zoneId: selected.zone.id,
      demandLevel: "high",
      demandsPerHour: selected.demandsPerHour,
      availableDrivers: selected.availableDrivers,
      distanceToZoneKm: selected.distanceToZoneKm,
      reason,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) return null;

  await recordTripEvent({
    eventKey: `reposition:${created.id}:created`,
    tripId: created.tripId,
    type: "reposition_recommendation_created",
    driverId: created.driverId,
    reason: created.reason,
    occurredAt: created.createdAt,
  });
  return serializeRecommendation(created, selected.zone);
}

export async function respondToRepositionRecommendation(
  driverId: number,
  recommendationId: number,
  decision: RepositionDecision,
) {
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [recommendation] = await tx
      .select()
      .from(repositionRecommendationsTable)
      .where(and(
        eq(repositionRecommendationsTable.id, recommendationId),
        eq(repositionRecommendationsTable.driverId, driverId),
      ))
      .for("update");
    if (!recommendation) return { status: "not_found" as const };
    if (recommendation.status !== "pending") return { status: "handled" as const, recommendation };
    if (recommendation.expiresAt <= now) {
      await tx.update(repositionRecommendationsTable)
        .set({ status: "expired", respondedAt: now })
        .where(eq(repositionRecommendationsTable.id, recommendation.id));
      return { status: "expired" as const, recommendation };
    }
    const status = decision === "accept" ? "accepted" : decision === "ignore" ? "ignored" : "dismissed";
    const [saved] = await tx.update(repositionRecommendationsTable)
      .set({ status, respondedAt: now })
      .where(eq(repositionRecommendationsTable.id, recommendation.id))
      .returning();
    return { status: "updated" as const, recommendation: saved };
  });

  if (updated.status === "not_found") return updated;
  const eventType = updated.status === "expired"
    ? "reposition_recommendation_expired"
    : updated.status === "handled"
      ? "reposition_recommendation_already_handled"
      : `reposition_recommendation_${updated.recommendation.status}`;
  await recordTripEvent({
    eventKey: `reposition:${recommendationId}:${eventType}:${now.toISOString()}`,
    tripId: updated.recommendation.tripId,
    type: eventType,
    driverId,
    reason: updated.status === "updated" ? decision : "recommendation_unavailable",
    occurredAt: now,
  });
  const recommendation = await getRecommendationWithZone(recommendationId);
  return { status: updated.status, recommendation };
}

export function logRepositionError(error: unknown) {
  logger.warn({ err: error }, "Reposition recommendation was not generated");
}