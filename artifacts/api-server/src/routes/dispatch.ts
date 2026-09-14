import { Router, type IRouter } from "express";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  GetDispatchSettingsResponse,
  ListDispatchOffersQueryParams,
  ListDispatchOffersResponse,
  RespondToDispatchOfferBody,
  RespondToDispatchOfferParams,
  RespondToDispatchOfferResponse,
  RespondToFareIncreaseBody,
  RespondToFareIncreaseParams,
  RespondToFareIncreaseResponse,
  UpdateDispatchSettingsBody,
  UpdateDispatchSettingsResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { activityTable, dispatchAttemptsTable, dispatchSettingsTable, driversTable, tripAnalyticsTable, tripsTable, type Trip } from "@workspace/db/schema";
import { ensureSeedData } from "../lib/seed";
import { advanceDispatch, getDispatchSettings, runDispatchSweep } from "../lib/dispatch";

const router: IRouter = Router();

function serializeTrip(trip: Trip) {
  return {
    ...trip,
    completedAt: trip.completedAt?.toISOString() ?? null,
  };
}

router.get("/dispatch/offers", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = ListDispatchOffersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date();
  const attempts = await db
    .select()
    .from(dispatchAttemptsTable)
    .where(and(
      eq(dispatchAttemptsTable.driverId, parsed.data.driverId),
      eq(dispatchAttemptsTable.status, "offered"),
      gt(dispatchAttemptsTable.expiresAt, now),
    ))
    .orderBy(asc(dispatchAttemptsTable.expiresAt));
  const tripIds = attempts.map((attempt) => attempt.tripId);
  const trips = tripIds.length > 0
    ? await db.select().from(tripsTable).where(inArray(tripsTable.id, tripIds))
    : [];
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));

  const offers = attempts
    .map((attempt) => {
      const trip = tripById.get(attempt.tripId);
      return trip ? { ...attempt, trip: serializeTrip(trip) } : null;
    })
    .filter((offer): offer is NonNullable<typeof offer> => offer !== null);

  res.json(ListDispatchOffersResponse.parse(offers));
});

router.post("/dispatch/offers/:id/response", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = RespondToDispatchOfferParams.safeParse(req.params);
  const parsed = RespondToDispatchOfferBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    const error = !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const settings = await getDispatchSettings();
  const result = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(dispatchAttemptsTable)
      .where(eq(dispatchAttemptsTable.id, params.data.id))
      .for("update");
    if (!attempt || attempt.driverId !== parsed.data.driverId) {
      return { status: "not_found" as const };
    }

    const [trip] = await tx
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.id, attempt.tripId))
      .for("update");
    if (!trip) return { status: "not_found" as const };

    const now = new Date();
    if (attempt.status !== "offered") {
      return { status: "unavailable" as const, trip };
    }
    if (attempt.expiresAt <= now) {
      await tx.update(dispatchAttemptsTable).set({ status: "expired", respondedAt: now }).where(eq(dispatchAttemptsTable.id, attempt.id));
      return { status: "expired" as const, trip };
    }

    if (parsed.data.decision === "reject") {
      await tx.update(dispatchAttemptsTable).set({ status: "rejected", respondedAt: now }).where(eq(dispatchAttemptsTable.id, attempt.id));
      return { status: "rejected" as const, trip };
    }

    const [driver] = await tx.select().from(driversTable).where(eq(driversTable.id, attempt.driverId)).for("update");
    if (!driver || driver.status !== "available" || driver.capacity <= 0) {
      await tx.update(dispatchAttemptsTable).set({ status: "unavailable", respondedAt: now }).where(eq(dispatchAttemptsTable.id, attempt.id));
      return { status: "unavailable" as const, trip };
    }
    if (driver.lastLocationAt.getTime() < now.getTime() - settings.gpsFreshnessSec * 1000) {
      await tx.update(dispatchAttemptsTable).set({ status: "unavailable", respondedAt: now }).where(eq(dispatchAttemptsTable.id, attempt.id));
      return { status: "unavailable" as const, trip };
    }
    if (trip.status !== "requested" || trip.driverId !== null) {
      await tx.update(dispatchAttemptsTable).set({ status: "unavailable", respondedAt: now }).where(eq(dispatchAttemptsTable.id, attempt.id));
      return { status: "unavailable" as const, trip };
    }

    const [acceptedTrip] = await tx
      .update(tripsTable)
      .set({
        status: "accepted",
        driverId: driver.id,
        driverName: driver.name,
        vehicle: driver.vehicle,
        fareProposalStatus: "none",
        fareProposalAmount: null,
      })
      .where(eq(tripsTable.id, trip.id))
      .returning();
    await tx.update(driversTable).set({ status: "on_trip" }).where(eq(driversTable.id, driver.id));
    await tx
      .update(dispatchAttemptsTable)
      .set({ status: "accepted", respondedAt: now })
      .where(eq(dispatchAttemptsTable.id, attempt.id));
    await tx
      .update(dispatchAttemptsTable)
      .set({ status: "cancelled", respondedAt: now })
      .where(and(
        eq(dispatchAttemptsTable.tripId, trip.id),
        eq(dispatchAttemptsTable.status, "offered"),
      ));
    await tx.insert(activityTable).values({
      type: "trip_requested",
      title: "Chauffeur attribué",
      description: `Course n°${trip.id} acceptée par ${driver.name}`,
    });

    if (!acceptedTrip) throw new Error("Accepted trip could not be saved");
    return { status: "accepted" as const, trip: acceptedTrip };
  });

  if (result.status === "not_found") {
    res.status(404).json({ error: "Dispatch offer not found" });
    return;
  }
  if (result.status === "unavailable" || result.status === "expired") {
    res.status(409).json({ error: "Dispatch offer is no longer available", status: result.status });
    return;
  }

  if (result.status === "rejected") {
    await advanceDispatch(result.trip.id, settings);
  }
  res.json(RespondToDispatchOfferResponse.parse({
    status: result.status,
    trip: serializeTrip(result.trip),
  }));
});

router.post("/trips/:id/fare-response", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = RespondToFareIncreaseParams.safeParse(req.params);
  const parsed = RespondToFareIncreaseBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    const error = !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const settings = await getDispatchSettings();
  const result = await db.transaction(async (tx) => {
    const [trip] = await tx
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.id, params.data.id))
      .for("update");
    if (!trip) return { status: "not_found" as const };
    if (trip.status !== "requested" || trip.fareProposalStatus !== "pending" || trip.fareProposalAmount === null) {
      return { status: "no_proposal" as const, trip };
    }

    const now = new Date();
    const accepted = parsed.data.decision === "accept";
    const [updatedTrip] = await tx
      .update(tripsTable)
      .set({
        fare: accepted ? trip.fare + trip.fareProposalAmount : trip.fare,
        fareIncreaseCount: accepted ? trip.fareIncreaseCount + 1 : trip.fareIncreaseCount,
        fareProposalStatus: accepted ? "accepted" : "rejected",
        fareProposalAmount: null,
        fareProposalAt: now,
      })
      .where(eq(tripsTable.id, trip.id))
      .returning();
    if (!updatedTrip) throw new Error("Fare proposal response could not be saved");
    await tx.insert(activityTable).values({
      type: "trip_requested",
      title: accepted ? "Hausse tarifaire acceptée" : "Hausse tarifaire refusée",
      description: `Course n°${trip.id} · ${accepted ? `+${trip.fareProposalAmount} FCFA` : "le tarif initial est conservé"}`,
    });
    return { status: accepted ? "accepted" as const : "rejected" as const, trip: updatedTrip };
  });

  if (result.status === "not_found") {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  if (result.status === "no_proposal") {
    res.status(409).json({ error: "No pending fare proposal" });
    return;
  }

  await db
    .update(tripAnalyticsTable)
    .set({
      acceptedFare: result.status === "accepted" ? result.trip.fare : undefined,
    })
    .where(eq(tripAnalyticsTable.tripId, result.trip.id));
  await advanceDispatch(result.trip.id, settings);
  res.json(RespondToFareIncreaseResponse.parse({
    status: result.status,
    trip: serializeTrip(result.trip),
  }));
});

router.get("/dispatch/settings", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const settings = await getDispatchSettings();
  res.json(GetDispatchSettingsResponse.parse(settings));
});

router.patch("/dispatch/settings", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = UpdateDispatchSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await getDispatchSettings();
  const next = { ...current, ...parsed.data };
  const radii = next.searchRadiiKm;
  const durations = next.stageDurationsMin;
  if (durations.length !== radii.length || radii.some((radius, index) => index > 0 && radius <= radii[index - 1]!)) {
    res.status(400).json({ error: "Search radii and stage durations must have the same length, with radii strictly increasing" });
    return;
  }
  if (next.fareIncreaseAmounts.length < next.maxFareIncreases) {
    res.status(400).json({ error: "A fare amount is required for each configured increase" });
    return;
  }

  const [updated] = await db
    .update(dispatchSettingsTable)
    .set(parsed.data)
    .where(eq(dispatchSettingsTable.id, current.id))
    .returning();
  if (!updated) {
    res.status(500).json({ error: "Dispatch settings could not be saved" });
    return;
  }
  await runDispatchSweep();
  res.json(UpdateDispatchSettingsResponse.parse(updated));
});

export default router;