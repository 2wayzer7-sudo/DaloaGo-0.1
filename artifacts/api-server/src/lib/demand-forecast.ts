import { eq, gte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  demandForecastSettingsTable,
  driversTable,
  tripAnalyticsTable,
  tripsTable,
  virtualZonesTable,
  type VirtualZone,
} from "@workspace/db/schema";
import { findZoneForPoint } from "./telemetry";

const SETTINGS_ID = 1;
const RECENT_WINDOW_HOURS = 24;
const RECENT_TREND_WINDOW_HOURS = 6;
const COMPARABLE_HISTORY_DAYS = 28;
const MAX_PROBABILITY = 0.85;

export type ForecastLevel = "low" | "normal" | "high" | "insufficient";

export type DemandForecast = {
  zoneId: number;
  zoneName: string;
  level: ForecastLevel;
  probabilities: { low: number; normal: number; high: number } | null;
  expectedDemandPerHour: number | null;
  recentDemandPerHour: number | null;
  comparableDemandPerHour: number | null;
  recentTrendPercent: number | null;
  availableDrivers: number;
  hourly: Array<{
    hour: string;
    observedDemand: number;
    comparableDemand: number;
    estimatedDemandPerHour: number | null;
  }>;
};

export type DemandForecastResult = {
  enabled: boolean;
  generatedAt: string;
  horizonHours: number;
  minimumDataPoints: number;
  zones: DemandForecast[];
};

export async function getDemandForecastSettings() {
  const [existing] = await db
    .select()
    .from(demandForecastSettingsTable)
    .where(eq(demandForecastSettingsTable.id, SETTINGS_ID));
  if (existing) return existing;
  const [created] = await db
    .insert(demandForecastSettingsTable)
    .values({ id: SETTINGS_ID })
    .returning();
  return created;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function hourKey(value: Date) {
  return `${value.getUTCDay()}:${value.getUTCHours()}`;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function hourStart(value: Date) {
  const result = new Date(value);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

function probabilityForLevel(level: Exclude<ForecastLevel, "insufficient">, sampleSize: number) {
  const dominant = clamp(0.45 + sampleSize / 80, 0.55, MAX_PROBABILITY);
  const remainder = (1 - dominant) / 2;
  return {
    low: level === "low" ? dominant : remainder,
    normal: level === "normal" ? dominant : remainder,
    high: level === "high" ? dominant : remainder,
  };
}

function comparableRate(rows: Date[]) {
  const days = new Set(rows.map(dateKey)).size;
  return days === 0 ? null : rows.length / days;
}

function getLevel(expected: number, zone: VirtualZone): Exclude<ForecastLevel, "insufficient"> {
  if (expected < zone.lowDemandPerHour) return "low";
  if (expected < zone.highDemandPerHour) return "normal";
  return "high";
}

function makeHourlyForecast(
  zone: VirtualZone,
  recentRows: Date[],
  historyRows: Date[],
  recentRate: number,
  trendFactor: number,
  now: Date,
  horizonHours: number,
) {
  const firstHour = hourStart(now);
  return Array.from({ length: horizonHours }, (_, index) => {
    const target = new Date(firstHour.getTime() + (index + 1) * 60 * 60 * 1000);
    const targetKey = hourKey(target);
    const observed = recentRows.filter((row) => hourKey(row) === targetKey).length;
    const comparableRows = historyRows.filter((row) => hourKey(row) === targetKey);
    const comparable = comparableRate(comparableRows);
    const baseline = comparable ?? recentRate;
    const estimated = round(Math.max(0, baseline * trendFactor));
    return {
      hour: target.toISOString(),
      observedDemand: observed,
      comparableDemand: comparableRows.length,
      estimatedDemandPerHour: estimated,
    };
  });
}

export async function buildDemandForecast(now = new Date()): Promise<DemandForecastResult> {
  const settings = await getDemandForecastSettings();
  const generatedAt = now.toISOString();
  if (!settings.enabled) {
    return {
      enabled: false,
      generatedAt,
      horizonHours: settings.forecastHorizonHours,
      minimumDataPoints: settings.minimumDataPoints,
      zones: [],
    };
  }

  const zones = await db
    .select()
    .from(virtualZonesTable)
    .where(eq(virtualZonesTable.active, true));
  const drivers = await db.select().from(driversTable);
  const recentFrom = new Date(now.getTime() - RECENT_WINDOW_HOURS * 60 * 60 * 1000);
  const historyFrom = new Date(now.getTime() - COMPARABLE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const recentDemand = await db
    .select({ trip: tripsTable, analytics: tripAnalyticsTable })
    .from(tripsTable)
    .innerJoin(tripAnalyticsTable, eq(tripAnalyticsTable.tripId, tripsTable.id))
    .where(gte(tripsTable.requestedAt, historyFrom));

  const forecasts = zones.map((zone): DemandForecast => {
    const zoneRows = recentDemand
      .filter(({ analytics, trip }) =>
        analytics.pickupZoneId === zone.id && trip.requestedAt >= historyFrom && trip.requestedAt <= now,
      )
      .map(({ trip }) => trip.requestedAt);
    const recentRows = zoneRows.filter((row) => row >= recentFrom);
    const recentShortFrom = new Date(now.getTime() - RECENT_TREND_WINDOW_HOURS * 60 * 60 * 1000);
    const recentShortRows = recentRows.filter((row) => row >= recentShortFrom);
    const priorRows = recentRows.filter((row) => row < recentShortFrom);
    const recentRate = recentRows.length / RECENT_WINDOW_HOURS;
    const shortRate = recentShortRows.length / RECENT_TREND_WINDOW_HOURS;
    const priorRate = priorRows.length / (RECENT_WINDOW_HOURS - RECENT_TREND_WINDOW_HOURS);
    const recentTrendPercent = priorRate === 0
      ? shortRate === 0 ? 0 : 100
      : round(((shortRate - priorRate) / priorRate) * 100);
    const trendFactor = clamp(1 + clamp(recentTrendPercent, -100, 100) / 100 * 0.25, 0.75, 1.25);
    const historyRows = zoneRows.filter((row) => row < recentFrom);
    const hourly = makeHourlyForecast(
      zone,
      recentRows,
      historyRows,
      recentRate,
      trendFactor,
      now,
      settings.forecastHorizonHours,
    );
    const comparableValues = hourly.map((slot) => {
      const target = new Date(slot.hour);
      const matching = historyRows.filter((row) => hourKey(row) === hourKey(target));
      return comparableRate(matching);
    }).filter((value): value is number => value !== null);
    const comparableDemandPerHour = comparableValues.length > 0
      ? round(comparableValues.reduce((sum, value) => sum + value, 0) / comparableValues.length)
      : null;
    const availableDrivers = drivers.filter((driver) =>
      driver.status === "available"
      && findZoneForPoint(driver.latitude, driver.longitude, [zone])?.id === zone.id,
    ).length;

    if (recentRows.length < settings.minimumDataPoints) {
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        level: "insufficient",
        probabilities: null,
        expectedDemandPerHour: null,
        recentDemandPerHour: round(recentRate),
        comparableDemandPerHour,
        recentTrendPercent,
        availableDrivers,
        hourly: hourly.map((slot) => ({ ...slot, estimatedDemandPerHour: null })),
      };
    }

    const expectedDemandPerHour = round(
      hourly.length > 0
        ? hourly.reduce((sum, slot) => sum + (slot.estimatedDemandPerHour ?? 0), 0) / hourly.length
        : recentRate * trendFactor,
    );
    const level = getLevel(expectedDemandPerHour, zone);
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      level,
      probabilities: probabilityForLevel(level, recentRows.length),
      expectedDemandPerHour,
      recentDemandPerHour: round(recentRate),
      comparableDemandPerHour,
      recentTrendPercent,
      availableDrivers,
      hourly,
    };
  });

  return {
    enabled: true,
    generatedAt,
    horizonHours: settings.forecastHorizonHours,
    minimumDataPoints: settings.minimumDataPoints,
    zones: forecasts,
  };
}

export async function getDemandForecastForZone(zoneId: number, now = new Date()) {
  const result = await buildDemandForecast(now);
  return result.enabled ? result.zones.find((zone) => zone.zoneId === zoneId) : undefined;
}