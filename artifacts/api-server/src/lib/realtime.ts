import { createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";

type TripEventType = "trip.created" | "trip.updated";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const clients = new Set<Duplex>();

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

export function attachRealtime(server: HttpServer) {
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
