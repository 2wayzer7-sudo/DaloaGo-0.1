import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import {
  GetDashboardActivityResponse,
  GetDashboardSummaryResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { driversTable, tripsTable } from "@workspace/db/schema";
import { ensureSeedData, getLatestActivity } from "../lib/seed";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const [trips, drivers] = await Promise.all([
    db.select().from(tripsTable),
    db.select().from(driversTable),
  ]);
  const completedTrips = trips.filter((trip) => trip.status === "completed");
  const decidedTrips = trips.filter(
    (trip) => trip.status === "completed" || trip.status === "cancelled",
  );
  const data = {
    tripsToday: trips.length,
    activeTrips: trips.filter((trip) =>
      ["requested", "accepted", "arriving", "in_progress"].includes(trip.status),
    ).length,
    availableDrivers: drivers.filter((driver) => driver.status === "available").length,
    revenueToday: completedTrips.reduce((sum, trip) => sum + trip.fare, 0),
    completionRate: decidedTrips.length === 0
      ? 0
      : Math.round((completedTrips.length / decidedTrips.length) * 100),
  };
  res.json(GetDashboardSummaryResponse.parse(data));
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const activity = await getLatestActivity();
  res.json(GetDashboardActivityResponse.parse(activity));
});

export default router;