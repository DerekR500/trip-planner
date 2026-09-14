import type { WebSocket } from "ws";

import type { ServerMessage } from "../../../shared/protocol.js";

/**
 * What we track per connection. `isAlive` is the heartbeat flag: set false before each
 * ping, set true again when the pong arrives. A socket that misses a beat is dead.
 */
export type Connection = {
  socket: WebSocket;
  tripId: string | null;
  displayName: string | null;
  isAlive: boolean;
};

/**
 * One room per trip. A plain Map of Sets — a client only ever receives traffic for the
 * trip it joined, so two trips never interfere.
 */
const rooms = new Map<string, Set<Connection>>();

export function join(connection: Connection, tripId: string, displayName: string): void {
  // Re-sending presence:hello (which reconnection does) must not leave the old room behind.
  if (connection.tripId && connection.tripId !== tripId) leave(connection);

  connection.tripId = tripId;
  connection.displayName = displayName;

  let room = rooms.get(tripId);
  if (!room) {
    room = new Set();
    rooms.set(tripId, room);
  }
  room.add(connection);
}

export function leave(connection: Connection): void {
  const { tripId } = connection;
  if (!tripId) return;

  const room = rooms.get(tripId);
  if (!room) return;

  room.delete(connection);
  // Drop empty rooms so the Map cannot grow forever as trips come and go.
  if (room.size === 0) rooms.delete(tripId);
}

/** Display names currently in a room, in join order, duplicates kept (two tabs, one name). */
export function usersIn(tripId: string): string[] {
  const room = rooms.get(tripId);
  if (!room) return [];
  return [...room].map((c) => c.displayName ?? "Anonymous");
}

export function send(socket: WebSocket, message: ServerMessage): void {
  // 1 === WebSocket.OPEN. Sending to a closing socket throws.
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

/** Broadcast to everyone in the room, including whoever triggered the change. */
export function broadcast(tripId: string, message: ServerMessage): void {
  const room = rooms.get(tripId);
  if (!room) return;

  const payload = JSON.stringify(message);
  for (const connection of room) {
    if (connection.socket.readyState === 1) connection.socket.send(payload);
  }
}
