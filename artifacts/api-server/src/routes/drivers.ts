import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  ListDriversResponse,
  UpdateDriverLocationBody,
  UpdateDriverLocationParams,
  UpdateDriverLocationResponse,
  UpdateDriverStatusBody,
  UpdateDriverStatusParams,
  UpdateDriverStatusResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { dispatchAttemptsTable, driversTable } from "@workspace/db/schema";
import { ensureSeedData } from "../lib/seed";
import { runDispatchSweep } from "../lib/dispatch";

const router: IRouter = Router();

router.get("/drivers", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const drivers = await db
    .select()
    .from(driversTable)
    .orderBy(asc(driversTable.status), asc(driversTable.name));
  res.json(ListDriversResponse.parse(drivers));
});

router.patch("/drivers/:id/location", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = UpdateDriverLocationParams.safeParse(req.params);
  const parsed = UpdateDriverLocationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    const error = !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const [driver] = await db
    .update(driversTable)
    .set({
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      lastLocationAt: new Date(),
    })
    .where(eq(driversTable.id, params.data.id))
    .returning();
  if (!driver) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }

  res.json(UpdateDriverLocationResponse.parse(driver));
});

router.patch("/drivers/:id/status", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = UpdateDriverStatusParams.safeParse(req.params);
  const parsed = UpdateDriverStatusBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    const error = !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [driver] = await tx
      .update(driversTable)
      .set({ status: parsed.data.status })
      .where(eq(driversTable.id, params.data.id))
      .returning();
    if (!driver) return { driver: undefined, tripIds: [] as number[] };

    const pendingOffers = parsed.data.status === "offline"
      ? await tx
        .select({ tripId: dispatchAttemptsTable.tripId })
        .from(dispatchAttemptsTable)
        .where(and(
          eq(dispatchAttemptsTable.driverId, driver.id),
          eq(dispatchAttemptsTable.status, "offered"),
        ))
      : [];
    if (pendingOffers.length > 0) {
      await tx
        .update(dispatchAttemptsTable)
        .set({ status: "unavailable", respondedAt: now })
        .where(and(
          eq(dispatchAttemptsTable.driverId, driver.id),
          eq(dispatchAttemptsTable.status, "offered"),
        ));
    }
    return { driver, tripIds: pendingOffers.map(({ tripId }) => tripId) };
  });

  if (!result.driver) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  await runDispatchSweep();
  res.json(UpdateDriverStatusResponse.parse(result.driver));
});

export default router;