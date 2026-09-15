import { createHash, randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { tripsTable } from "@workspace/db/schema";
import { logger } from "./logger";

type TripEventType = "trip.created" | "trip.updated";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TRIP_EVENTS_CHANNEL = "daloago_trip_events";
const INSTANCE_ID = randomUUID();
const clients = new Set<Duplex>();
type NotificationClient = {
  on(event: "notification", listener: (message: { channel: string; payload?: string }) => void): NotificationClient;
  on(event: "error", listener: (error: Error) => void): NotificationClient;
  on(event: "end", listener: () => void): NotificationClient;
  query(query: string): Promise<unknown>;
  release(destroy?: boolean): void;
};
let notificationClient: NotificationClient | null = null;
let notificationReconnectTimer: NodeJS.Timeout | undefined;
let notificationConnecting = false;

function frame(payload: string, opcode = 0x1): Buffer {
  const body = Buffer.from(payload);
  if (body.length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
  }
  if (body.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}

function send(socket: Duplex, payload: string, opcode = 0x1) {
  if (!socket.destroyed) socket.write(frame(payload, opcode));
}

function broadcastTripEvent(type: TripEventType, trip: object) {
  const payload = JSON.stringify({ type, trip });
  for (const socket of clients) {
    try {
      send(socket, payload);
    } catch {
      clients.delete(socket);
      socket.destroy();
    }
  }
}

function scheduleNotificationReconnect() {
  if (notificationReconnectTimer || notificationConnecting) return;
  notificationReconnectTimer = setTimeout(() => {
    notificationReconnectTimer = undefined;
    void connectNotificationListener();
  }, 1000);
  notificationReconnectTimer.unref();
}

function handleNotificationClientFailure(client: NotificationClient, error: unknown) {
  if (notificationClient !== client) return;
  notificationClient = null;
  logger.warn({ err: error }, "Realtime PostgreSQL listener disconnected");
  try {
    client.release(true);
  } catch {
    // The pool may already have removed the failed client.
  }
  scheduleNotificationReconnect();
}

function isTripEventType(value: unknown): value is TripEventType {
  return value === "trip.created" || value === "trip.updated";
}

async function handleTripNotification(payload: string) {
  let notification: unknown;
  try {
    notification = JSON.parse(payload);
  } catch {
    return;
  }

  if (typeof notification !== "object" || notification === null) return;
  const event = notification as Record<string, unknown>;
  if (
    typeof event.source !== "string" ||
    event.source === INSTANCE_ID ||
    !isTripEventType(event.type) ||
    typeof event.tripId !== "number" ||
    !Number.isInteger(event.tripId)
  ) {
    return;
  }

  const [trip] = await db
    .select()
    .from(tripsTable)
    .where(eq(tripsTable.id, event.tripId));
  if (trip) broadcastTripEvent(event.type, trip);
}

async function connectNotificationListener() {
  if (notificationClient || notificationConnecting) return;
  notificationConnecting = true;

  let client: NotificationClient | undefined;
  try {
    const connectedClient = await pool.connect();
    client = connectedClient;
    notificationClient = connectedClient;
    connectedClient.on("notification", (message) => {
      if (message.channel !== TRIP_EVENTS_CHANNEL || !message.payload) return;
      void handleTripNotification(message.payload).catch((error) => {
        logger.warn({ err: error }, "Realtime PostgreSQL notification failed");
      });
    });
    connectedClient.on("error", (error) => handleNotificationClientFailure(connectedClient, error));
    connectedClient.on("end", () => handleNotificationClientFailure(connectedClient, new Error("PostgreSQL listener ended")));
    await connectedClient.query(`LISTEN ${TRIP_EVENTS_CHANNEL}`);
  } catch (error) {
    if (client) {
      if (notificationClient === client) notificationClient = null;
      try {
        client.release(true);
      } catch {
        // The pool may already have removed the failed client.
      }
    }
    logger.warn({ err: error }, "Realtime PostgreSQL listener unavailable");
    scheduleNotificationReconnect();
  } finally {
    notificationConnecting = false;
  }
}

export function attachRealtime(server: HttpServer) {
  void connectNotificationListener();
  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url ?? "/", "http://" + (request.headers.host ?? "localhost"));
    const key = request.headers["sec-websocket-key"];
    if (url.pathname !== "/api/realtime" || typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: " + accept,
      "",
      "",
    ].join("\r\n"));

    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => { clients.delete(socket); socket.destroy(); });
    socket.on("data", (data) => {
      const opcode = data[0] & 0x0f;
      if (opcode === 0x8) socket.end();
      if (opcode === 0x9) send(socket, "", 0xA);
    });
    send(socket, JSON.stringify({ type: "realtime.ready" }));
  });
}

export function publishTripEvent(type: TripEventType, trip: object) {
  broadcastTripEvent(type, trip);

  const tripId = (
    typeof trip === "object" &&
    trip !== null &&
    "id" in trip &&
    typeof trip.id === "number"
  ) ? trip.id : undefined;
  if (tripId === undefined) return;

  void pool
    .query("SELECT pg_notify($1, $2)", [
      TRIP_EVENTS_CHANNEL,
      JSON.stringify({ source: INSTANCE_ID, type, tripId }),
    ])
    .catch((error) => {
      logger.warn({ err: error }, "Realtime PostgreSQL notification failed");
    });
  }
