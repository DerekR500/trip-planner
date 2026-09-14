import type { Server } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import type { ClientMessage } from "../../../shared/protocol.js";
import {
  addStop,
  loadTripState,
  removeStop,
  renameStop,
  reorderStop,
  StopServiceError,
} from "../services/stops.js";
import { enqueue } from "./queue.js";
import { broadcast, join, leave, send, usersIn, type Connection } from "./rooms.js";

/** How often to ping. A socket that hasn't ponged by the next tick is terminated. */
const HEARTBEAT_MS = 30_000;

/** Parses a frame into a ClientMessage, or null if it is not one we recognise. */
function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { type?: unknown; tripId?: unknown };
  if (typeof candidate.type !== "string" || typeof candidate.tripId !== "string") return null;

  // The per-field checks live in the service layer, which throws StopServiceError.
  return value as ClientMessage;
}

async function handleMessage(connection: Connection, message: ClientMessage): Promise<void> {
  // Every message except the initial hello requires an established room, and may only
  // act on the trip this connection actually joined — a client cannot mutate someone
  // else's trip by putting a different tripId in the payload.
  if (message.type !== "presence:hello") {
    if (connection.tripId === null) {
      send(connection.socket, { type: "error", message: "Send presence:hello first." });
      return;
    }
    if (message.tripId !== connection.tripId) {
      send(connection.socket, { type: "error", message: "tripId does not match this session." });
      return;
    }
  }

  switch (message.type) {
    case "presence:hello": {
      const name = message.displayName.trim().slice(0, 40);
      if (!name) {
        send(connection.socket, { type: "error", message: "displayName is required." });
        return;
      }

      // Queued alongside mutations so the snapshot is taken atomically with joining the
      // room. Otherwise a mutation could commit and broadcast in the gap between reading
      // the snapshot and joining, and the joiner would either miss it or overwrite it
      // with a stale trip:state.
      await enqueue(message.tripId, async () => {
        const state = await loadTripState(message.tripId);
        if (!state) {
          send(connection.socket, { type: "error", message: "Trip not found." });
          return;
        }

        join(connection, message.tripId, name);

        // The joiner gets the full snapshot; everyone (including them) gets the roster.
        send(connection.socket, {
          type: "trip:state",
          trip: state.trip,
          stops: state.stops,
          users: usersIn(message.tripId),
        });
        broadcast(message.tripId, { type: "presence:update", users: usersIn(message.tripId) });
      });
      return;
    }

    case "stop:add": {
      const stop = await enqueue(message.tripId, () => addStop(message));
      broadcast(message.tripId, { type: "stop:added", stop });
      return;
    }

    case "stop:remove": {
      const stopId = await enqueue(message.tripId, () =>
        removeStop(message.tripId, message.stopId),
      );
      broadcast(message.tripId, { type: "stop:removed", stopId });
      return;
    }

    case "stop:rename": {
      const stop = await enqueue(message.tripId, () =>
        renameStop(message.tripId, message.stopId, message.name),
      );
      broadcast(message.tripId, { type: "stop:renamed", stop });
      return;
    }

    case "stop:reorder": {
      // Serialized: the rank is computed against committed state, so two simultaneous
      // drags can never mint the same key between the same pair of neighbours.
      const stop = await enqueue(message.tripId, () =>
        reorderStop(message.tripId, message.stopId, message.beforeId, message.afterId),
      );
      // opId goes to the whole room, but only the originator recognises it and clears
      // its optimistic overlay; everyone else just applies the new rank.
      broadcast(message.tripId, { type: "stop:reordered", stop, opId: message.opId });
      return;
    }
  }
}

/** Every open connection, so the heartbeat can read each one's isAlive flag. */
const connections = new Set<Connection>();

export function attachWebSocketServer(server: Server): WebSocketServer {
  // Sharing the HTTP server means ws lives on port 3000 alongside Express — no second
  // published port, and the same CORS-free origin the frontend already talks to.
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket: WebSocket) => {
    const connection: Connection = {
      socket,
      tripId: null,
      displayName: null,
      isAlive: true,
    };
    connections.add(connection);

    socket.on("pong", () => {
      connection.isAlive = true;
    });

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw.toString());
      if (!message) {
        send(socket, { type: "error", message: "Malformed message." });
        return;
      }

      // Echoed back on failure so a client whose optimistic drag was rejected knows
      // exactly which move to roll back.
      const opId = message.type === "stop:reorder" ? message.opId : undefined;

      void handleMessage(connection, message).catch((err: unknown) => {
        if (err instanceof StopServiceError) {
          // Expected, user-facing: tell only the sender, leave the room alone.
          send(socket, { type: "error", message: err.message, opId });
          return;
        }
        console.error("WebSocket handler failed:", err);
        send(socket, { type: "error", message: "Internal server error.", opId });
      });
    });

    socket.on("close", () => {
      const { tripId } = connection;
      connections.delete(connection);
      leave(connection);
      if (tripId) broadcast(tripId, { type: "presence:update", users: usersIn(tripId) });
    });

    socket.on("error", (err) => {
      console.error("WebSocket connection error:", err.message);
    });
  });

  // A browser tab that is closed abruptly (or a laptop that sleeps) never sends a close
  // frame, so without this the room would keep a ghost member forever. Each tick marks
  // every connection dead and pings it; anything still marked dead on the next tick
  // never answered and gets terminated (which fires 'close' and cleans up its room).
  const heartbeat = setInterval(() => {
    for (const connection of connections) {
      if (!connection.isAlive) {
        connection.socket.terminate();
        continue;
      }
      connection.isAlive = false;
      connection.socket.ping();
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  return wss;
}
