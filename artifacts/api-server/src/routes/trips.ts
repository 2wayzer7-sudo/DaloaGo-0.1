import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  CreateTripBody,
  CreateTripResponse,
  GetTripParams,
  GetTripResponse,
  ListTripsQueryParams,
  ListTripsResponse,
  UpdateTripStatusBody,
  UpdateTripStatusParams,
  UpdateTripStatusResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { activityTable, dispatchAttemptsTable, driversTable, tripsTable, type Trip } from "@workspace/db/schema";
import { advanceDispatch } from "../lib/dispatch";
import { ensureSeedData } from "../lib/seed";
import { generateRepositionRecommendation, logRepositionError } from "../lib/reposition";
import { recordTripRequest, recordTripStatus } from "../lib/telemetry";
import { publishTripEvent } from "../lib/realtime";

const router: IRouter = Router();

const statusValues = new Set([
  "requested",
  "accepted",
  "arriving",
  "in_progress",
  "completed",
  "cancelled",
]);

const activityStatusLabels: Record<string, string> = {
  requested: "demandée",
  accepted: "acceptée",
  arriving: "en approche",
  in_progress: "en cours",
  completed: "terminée",
  cancelled: "annulée",
};

const allowedStatusTransitions: Record<string, readonly string[]> = {
  requested: ["cancelled"],
  accepted: ["arriving", "cancelled"],
  arriving: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function serializeTrip(trip: Trip) {
  return {
    ...trip,
    completedAt: trip.completedAt?.toISOString() ?? null,
  };
}

router.get("/trips", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = ListTripsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid trip filters");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const filters = [];
  if (parsed.data.status) {
    filters.push(eq(tripsTable.status, parsed.data.status));
  }
  if (parsed.data.role === "driver") {
    filters.push(
      inArray(tripsTable.status, ["requested", "accepted", "arriving", "in_progress"]),
    );
  }

  const trips = await db
    .select()
    .from(tripsTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tripsTable.requestedAt));

  res.json(ListTripsResponse.parse(trips.map(serializeTrip)));
});

router.post("/trips", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = CreateTripBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid trip request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const fare = Math.round(500 + parsed.data.distanceKm * 150 + parsed.data.durationMin * 20);
  const [trip] = await db
    .insert(tripsTable)
    .values({
      passengerName: parsed.data.passengerName,
      passengerPhone: parsed.data.passengerPhone ?? null,
      pickup: parsed.data.pickup,
      destination: parsed.data.destination,
      distanceKm: parsed.data.distanceKm,
      durationMin: parsed.data.durationMin,
      fare,
      initialFare: fare,
      pickupLatitude: parsed.data.pickupLatitude ?? 6.877,
      pickupLongitude: parsed.data.pickupLongitude ?? -6.45,
      destinationLatitude: parsed.data.destinationLatitude ?? null,
      destinationLongitude: parsed.data.destinationLongitude ?? null,
      status: "requested",
      dispatchStartedAt: new Date(),
    })
    .returning();

  await db.insert(activityTable).values({
    type: "trip_requested",
    title: "Nouvelle course",
    description: `${parsed.data.passengerName} demande un trajet de ${parsed.data.pickup} vers ${parsed.data.destination}`,
  });

  await recordTripRequest(trip);
  await advanceDispatch(trip.id);
  publishTripEvent("trip.created", trip);
  res.status(201).json(CreateTripResponse.parse(serializeTrip(trip)));
});

router.get("/trips/:id", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = GetTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [trip] = await db
    .select()
    .from(tripsTable)
    .where(eq(tripsTable.id, params.data.id));

  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  res.json(GetTripResponse.parse(serializeTrip(trip)));
});

router.patch("/trips/:id", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = UpdateTripStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTripStatusBody.safeParse(req.body);
  if (!parsed.success || !statusValues.has(parsed.data.status)) {
    res.status(400).json({ error: parsed.success ? "Invalid trip status" : parsed.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.id, params.data.id))
      .for("update");
    if (!current) return { kind: "not_found" as const };

    const allowedNextStatuses = allowedStatusTransitions[current.status] ?? [];
    if (!allowedNextStatuses.includes(parsed.data.status)) {
      return {
        kind: "invalid_transition" as const,
        currentStatus: current.status,
        requestedStatus: parsed.data.status,
      };
    }

    if (parsed.data.status === "accepted" && !current.driverId) {
      return { kind: "accepted_without_driver" as const };
    }

    const now = new Date();
    if (parsed.data.status === "completed" || parsed.data.status === "cancelled") {
      if (current.driverId) {
        await tx
          .update(driversTable)
          .set({ status: "available" })
          .where(eq(driversTable.id, current.driverId));
      }
      if (parsed.data.status === "cancelled") {
        await tx
          .update(dispatchAttemptsTable)
          .set({ status: "cancelled", respondedAt: now })
          .where(and(
            eq(dispatchAttemptsTable.tripId, current.id),
            eq(dispatchAttemptsTable.status, "offered"),
          ));
      }
    }

    const [trip] = await tx
      .update(tripsTable)
      .set({
        status: parsed.data.status,
        completedAt: parsed.data.status === "completed" ? now : current.completedAt,
        cancellationReason: parsed.data.status === "cancelled"
          ? parsed.data.reason ?? "non_precisee"
          : current.cancellationReason,
      })
      .where(eq(tripsTable.id, current.id))
      .returning();
    if (!trip) throw new Error("Trip status could not be saved");

    await tx.insert(activityTable).values({
      type: parsed.data.status === "completed" ? "trip_completed" : "trip_requested",
      title: parsed.data.status === "completed" ? "Course terminée" : "Course mise à jour",
      description: `Course n°${current.id} · ${activityStatusLabels[parsed.data.status]}`,
    });

    return {
      kind: "updated" as const,
      trip,
      previousStatus: current.status,
    };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  if (result.kind === "accepted_without_driver") {
    res.status(409).json({ error: "A trip must be accepted through a dispatch offer" });
    return;
  }
  if (result.kind === "invalid_transition") {
    res.status(409).json({
      error: `Invalid trip status transition: ${result.currentStatus} -> ${result.requestedStatus}`,
      currentStatus: result.currentStatus,
      requestedStatus: result.requestedStatus,
    });
    return;
  }

  await recordTripStatus({
    trip: result.trip,
    previousStatus: result.previousStatus,
    reason: parsed.data.reason,
  });
  if (parsed.data.status === "completed" && result.trip.driverId) {
    generateRepositionRecommendation({ tripId: result.trip.id, driverId: result.trip.driverId }).catch(logRepositionError);
  }
  publishTripEvent("trip.updated", result.trip);
  res.json(UpdateTripStatusResponse.parse(serializeTrip(result.trip)));
});

export default router;