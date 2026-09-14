import { Router, type IRouter } from "express";
import {
  GetDemandForecastResponse,
  GetDemandForecastSettingsResponse,
  UpdateDemandForecastSettingsBody,
  UpdateDemandForecastSettingsResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { demandForecastSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeedData } from "../lib/seed";
import {
  buildDemandForecast,
  getDemandForecastSettings,
} from "../lib/demand-forecast";

const router: IRouter = Router();

router.get("/demand-forecast", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const forecast = await buildDemandForecast();
  res.json(GetDemandForecastResponse.parse(forecast));
});

router.get("/demand-forecast/settings", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const settings = await getDemandForecastSettings();
  res.json(GetDemandForecastSettingsResponse.parse(settings));
});

router.patch("/demand-forecast/settings", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = UpdateDemandForecastSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const current = await getDemandForecastSettings();
  const updates = parsed.data as Partial<typeof demandForecastSettingsTable.$inferInsert>;
  if (
    (updates.minimumDataPoints !== undefined && !Number.isInteger(updates.minimumDataPoints))
    || (updates.forecastHorizonHours !== undefined && !Number.isInteger(updates.forecastHorizonHours))
  ) {
    res.status(400).json({ error: "Forecast thresholds and horizon must be whole numbers" });
    return;
  }
  const [updated] = await db
    .update(demandForecastSettingsTable)
    .set(updates)
    .where(eq(demandForecastSettingsTable.id, current.id))
    .returning();
  res.json(UpdateDemandForecastSettingsResponse.parse(updated));
});

export default router;