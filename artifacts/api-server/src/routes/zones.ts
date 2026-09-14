import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  CreateVirtualZoneBody,
  CreateVirtualZoneResponse,
  GetVirtualZoneStatsParams,
  GetVirtualZoneStatsResponse,
  ListVirtualZonesResponse,
  UpdateVirtualZoneBody,
  UpdateVirtualZoneParams,
  UpdateVirtualZoneResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  driversTable,
  tripAnalyticsTable,
  tripEventsTable,
  tripsTable,
  virtualZonesTable,
} from "@workspace/db/schema";
import { ensureSeedData } from "../lib/seed";
import { collectTelemetry, findZoneForPoint } from "../lib/telemetry";

const router: IRouter = Router();

function average(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => value !== null && value !== undefined);
  if (usable.length === 0) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10) / 10;
}

async function getZoneStats(zoneId: number, from: Date, to: Date) {
  const [zone] = await db.select().from(virtualZonesTable).where(eq(virtualZonesTable.id, zoneId));
  if (!zone) return undefined;

  const demandRows = await db
    .select({ trip: tripsTable, analytics: tripAnalyticsTable })
    .from(tripsTable)
    .innerJoin(tripAnalyticsTable, eq(tripAnalyticsTable.tripId, tripsTable.id))
    .where(and(
      eq(tripAnalyticsTable.pickupZoneId, zone.id),
      gte(tripsTable.requestedAt, from),
      lte(tripsTable.requestedAt, to),
    ));
  const tripIds = new Set(demandRows.map(({ trip }) => trip.id));
  const events = tripIds.size > 0
    ? await db.select().from(tripEventsTable)
      .where(and(gte(tripEventsTable.occurredAt, from), lte(tripEventsTable.occurredAt, to)))
    : [];
  const zoneEvents = events.filter((event) => tripIds.has(event.tripId));
  const drivers = await db.select().from(driversTable);
  const zoneDrivers = drivers.filter((driver) => findZoneForPoint(driver.latitude, driver.longitude, [zone])?.id === zone.id);
  const hours = Math.max((to.getTime() - from.getTime()) / 3600000, 1 / 60);
  const demandsPerHour = Math.round((demandRows.length / hours) * 10) / 10;
  const demandLevel = demandRows.length < zone.minSampleSize
    ? "insufficient"
    : demandsPerHour < zone.lowDemandPerHour
      ? "low"
      : demandsPerHour < zone.highDemandPerHour
        ? "medium"
        : "high";

  return {
    zoneId: zone.id,
    from: from.toISOString(),
    to: to.toISOString(),
    demands: demandRows.length,
    completedTrips: demandRows.filter(({ trip }) => trip.status === "completed").length,
    demandsPerHour,
    availableDrivers: zoneDrivers.filter((driver) => driver.status === "available").length,
    activeDrivers: zoneDrivers.filter((driver) => driver.status === "on_trip").length,
    averageSearchTimeSec: average(demandRows.map(({ analytics }) => analytics.searchDurationSec)),
    averageWaitTimeSec: average(demandRows.map(({ analytics }) => analytics.approachDurationSec)),
    refusals: zoneEvents.filter((event) => event.type === "offer_rejected").length,
    cancellations: demandRows.filter(({ trip }) => trip.status === "cancelled").length,
    demandLevel,
    demandLevelLabel: {
      low: "faible",
      medium: "moyenne",
      high: "forte",
      insufficient: "données insuffisantes",
    }[demandLevel],
  };
}

router.get("/zones", async (_req, res): Promise<void> => {
  await ensureSeedData();
  await collectTelemetry();
  const zones = await db.select().from(virtualZonesTable).orderBy(virtualZonesTable.name);
  res.json(ListVirtualZonesResponse.parse(zones));
});

router.post("/zones", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = CreateVirtualZoneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.highDemandPerHour <= parsed.data.lowDemandPerHour) {
    res.status(400).json({ error: "The high demand threshold must be greater than the low threshold" });
    return;
  }
  const [zone] = await db.insert(virtualZonesTable).values(parsed.data).returning();
  res.status(201).json(CreateVirtualZoneResponse.parse(zone));
});

router.patch("/zones/:id", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = UpdateVirtualZoneParams.safeParse(req.params);
  const parsed = UpdateVirtualZoneBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [current] = await db.select().from(virtualZonesTable).where(eq(virtualZonesTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }
  const nextLow = parsed.data.lowDemandPerHour ?? current.lowDemandPerHour;
  const nextHigh = parsed.data.highDemandPerHour ?? current.highDemandPerHour;
  if (nextHigh <= nextLow) {
    res.status(400).json({ error: "The high demand threshold must be greater than the low threshold" });
    return;
  }
  const [zone] = await db
    .update(virtualZonesTable)
    .set(parsed.data)
    .where(eq(virtualZonesTable.id, params.data.id))
    .returning();
  res.json(UpdateVirtualZoneResponse.parse(zone));
});

router.get("/zones/:id/stats", async (req, res): Promise<void> => {
  await ensureSeedData();
  await collectTelemetry();
  const params = GetVirtualZoneStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = now;
  const stats = await getZoneStats(params.data.id, from, to);
  if (!stats) {
    res.status(404).json({ error: "Zone not found" });
    return;
  }
  res.json(GetVirtualZoneStatsResponse.parse(stats));
});

export default router;