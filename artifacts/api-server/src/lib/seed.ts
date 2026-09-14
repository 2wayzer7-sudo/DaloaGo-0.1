import { db } from "@workspace/db";
import { activityTable, driversTable, tripsTable, virtualZonesTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

let seedPromise: Promise<void> | undefined;

export async function ensureSeedData(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedIfEmpty().catch((error) => {
      seedPromise = undefined;
      throw error;
    });
  }

  await seedPromise;
}

async function seedIfEmpty(): Promise<void> {
  const [tripRows, driverRows, activityRows, zoneRows] = await Promise.all([
    db.select({ id: tripsTable.id }).from(tripsTable).limit(1),
    db.select({ id: driversTable.id }).from(driversTable).limit(1),
    db.select({ id: activityTable.id }).from(activityTable).limit(1),
    db.select({ id: virtualZonesTable.id }).from(virtualZonesTable).limit(1),
  ]);

  if (driverRows.length === 0) {
    await db.insert(driversTable).values([
      {
        name: "Yves Kouassi",
        phone: "+225 07 08 12 34 56",
        vehicle: "Toyota Corolla blanche",
        plate: "225 AB 42",
        rating: 4.9,
        status: "available",
        tripsToday: 8,
      },
      {
        name: "Mariam Koné",
        phone: "+225 05 06 78 90 12",
        vehicle: "Suzuki Swift grise",
        plate: "225 CD 18",
        rating: 4.8,
        status: "on_trip",
        tripsToday: 11,
      },
      {
        name: "Serge Bamba",
        phone: "+225 01 02 45 67 89",
        vehicle: "Toyota Yaris bleue",
        plate: "225 EF 07",
        rating: 4.7,
        status: "available",
        tripsToday: 5,
      },
    ]);
  }

  const drivers = await db
    .select()
    .from(driversTable)
    .orderBy(driversTable.id)
    .limit(3);

  if (tripRows.length === 0) {
    const now = new Date();
    const earlier = new Date(now.getTime() - 52 * 60 * 1000);
    const oldest = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    await db.insert(tripsTable).values([
      {
        passengerName: "Awa Traoré",
        passengerPhone: "+225 07 09 21 44 10",
        pickup: "Quartier Commerce",
        destination: "Gare routière de Daloa",
        status: "in_progress",
        fare: 2200,
        initialFare: 2200,
        distanceKm: 6.4,
        durationMin: 18,
        pickupLatitude: 6.877,
        pickupLongitude: -6.45,
        driverId: drivers[1]?.id ?? null,
        driverName: drivers[1]?.name ?? "Mariam Koné",
        vehicle: drivers[1]?.vehicle ?? "Suzuki Swift grise",
        requestedAt: earlier,
      },
      {
        passengerName: "Koffi N'Guessan",
        passengerPhone: "+225 05 04 13 20 31",
        pickup: "Université Jean Lorougnon Guédé",
        destination: "Grand marché",
        status: "completed",
        fare: 1800,
        initialFare: 1800,
        distanceKm: 4.8,
        durationMin: 14,
        pickupLatitude: 6.877,
        pickupLongitude: -6.45,
        driverId: drivers[0]?.id ?? null,
        driverName: drivers[0]?.name ?? "Yves Kouassi",
        vehicle: drivers[0]?.vehicle ?? "Toyota Corolla blanche",
        requestedAt: oldest,
        completedAt: new Date(oldest.getTime() + 30 * 60 * 1000),
      },
      {
        passengerName: "Nadia Yao",
        passengerPhone: null,
        pickup: "Hôtel La Paix",
        destination: "Aéroport de Daloa",
        status: "requested",
        fare: 3100,
        initialFare: 3100,
        distanceKm: 9.6,
        durationMin: 26,
        pickupLatitude: 6.877,
        pickupLongitude: -6.45,
        driverId: null,
        driverName: null,
        vehicle: null,
        requestedAt: now,
      },
    ]);
  }

  if (activityRows.length === 0) {
    await db.insert(activityTable).values([
      {
        type: "trip_requested",
        title: "Nouvelle course",
        description: "Nadia Yao demande une course vers l'aéroport de Daloa",
        createdAt: new Date(),
      },
      {
        type: "trip_completed",
        title: "Course terminée",
        description: "Koffi N'Guessan — 1 800 FCFA encaissés",
        createdAt: new Date(Date.now() - 38 * 60 * 1000),
      },
      {
        type: "driver_joined",
        title: "Chauffeur connecté",
        description: "Serge Bamba est disponible dans le secteur Commerce",
        createdAt: new Date(Date.now() - 74 * 60 * 1000),
      },
    ]);
  }

  if (zoneRows.length === 0) {
    await db.insert(virtualZonesTable).values([
      {
        name: "Centre-ville",
        description: "Zone de référence autour du centre de Daloa",
        centerLatitude: 6.877,
        centerLongitude: -6.45,
        radiusKm: 2.5,
        lowDemandPerHour: 1,
        highDemandPerHour: 3,
        minSampleSize: 3,
      },
      {
        name: "Tazibouo",
        description: "Zone configurable autour du quartier Tazibouo",
        centerLatitude: 6.885,
        centerLongitude: -6.405,
        radiusKm: 2,
        lowDemandPerHour: 1,
        highDemandPerHour: 3,
        minSampleSize: 3,
      },
    ]);
  }
}

export async function getLatestActivity(limit = 10) {
  return db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(limit);
}