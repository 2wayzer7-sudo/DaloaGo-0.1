import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { GetTripTelemetryParams, GetTripTelemetryResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { tripAnalyticsTable, tripEventsTable, tripsTable } from "@workspace/db/schema";
import { ensureSeedData } from "../lib/seed";
import { collectTelemetry } from "../lib/telemetry";

const router: IRouter = Router();

router.get("/trips/:id/telemetry", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = GetTripTelemetryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable).where(eq(tripsTable.id, params.data.id));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  await collectTelemetry();
  const [analytics] = await db
    .select()
    .from(tripAnalyticsTable)
    .where(eq(tripAnalyticsTable.tripId, params.data.id));
  const events = await db
    .select()
    .from(tripEventsTable)
    .where(eq(tripEventsTable.tripId, params.data.id))
    .orderBy(asc(tripEventsTable.occurredAt), asc(tripEventsTable.id));
  if (!analytics) {
    res.status(404).json({ error: "Trip telemetry not found" });
    return;
  }
  res.json(GetTripTelemetryResponse.parse({ tripId: params.data.id, analytics, events }));
});

export default router;