import { Router, type IRouter } from "express";
import {
  GetDriverRepositionRecommendationParams,
  GetDriverRepositionRecommendationResponse,
  GetRepositionSettingsResponse,
  RespondToDriverRepositionRecommendationBody,
  RespondToDriverRepositionRecommendationParams,
  RespondToDriverRepositionRecommendationResponse,
  UpdateRepositionSettingsBody,
  UpdateRepositionSettingsResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { driversTable, repositionSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeedData } from "../lib/seed";
import {
  getPendingRepositionRecommendation,
  getRepositionSettings,
  respondToRepositionRecommendation,
} from "../lib/reposition";

const router: IRouter = Router();

router.get("/drivers/:id/reposition-recommendation", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = GetDriverRepositionRecommendationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [driver] = await db.select({ id: driversTable.id }).from(driversTable).where(eq(driversTable.id, params.data.id));
  if (!driver) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  const recommendation = await getPendingRepositionRecommendation(driver.id);
  res.json(GetDriverRepositionRecommendationResponse.parse({ recommendation }));
});

router.post("/drivers/:id/reposition-recommendation/:recommendationId/response", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = RespondToDriverRepositionRecommendationParams.safeParse(req.params);
  const parsed = RespondToDriverRepositionRecommendationBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await respondToRepositionRecommendation(params.data.id, params.data.recommendationId, parsed.data.decision);
  if (result.status === "not_found") {
    res.status(404).json({ error: "Reposition recommendation not found" });
    return;
  }
  if (result.status === "expired" || result.status === "handled") {
    res.status(409).json({ error: "Reposition recommendation is no longer available", status: result.status });
    return;
  }
  res.json(RespondToDriverRepositionRecommendationResponse.parse({ recommendation: result.recommendation }));
});

router.get("/reposition/settings", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const settings = await getRepositionSettings();
  res.json(GetRepositionSettingsResponse.parse(settings));
});

router.patch("/reposition/settings", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = UpdateRepositionSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const current = await getRepositionSettings();
  const [updated] = await db
    .update(repositionSettingsTable)
    .set(parsed.data)
    .where(eq(repositionSettingsTable.id, current.id))
    .returning();
  res.json(UpdateRepositionSettingsResponse.parse(updated));
});

export default router;