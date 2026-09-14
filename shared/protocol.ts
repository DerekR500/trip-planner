/**
 * The wire protocol, shared by the browser and the server.
 *
 * Ordering rule for every client: sort by (rank, id). The id is a tie-breaker so that if
 * two stops ever end up with the same rank, every client still agrees on the order.
 *
 * Both sides import these exact types, so a change here becomes a compile error on
 * whichever end stops agreeing. Nothing is duplicated.
 *
 * Timestamps are strings, not Date: JSON has no Date type, so a Date sent over the wire
 * always arrives as an ISO string. The server converts explicitly (see toWireStop).
 */

export type Trip = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type Stop = {
  id: string;
  tripId: string;
  name: string;
  address: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Fractional index. Clients must always sort by this, never trust arrival order. */
  rank: string;
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ client -> server */

export type PresenceHello = {
  type: "presence:hello";
  tripId: string;
  displayName: string;
};

export type StopAdd = {
  type: "stop:add";
  tripId: string;
  name: string;
  address: string | null;
  placeId: string | null;
  lat: number;
  lng: number;
};

export type StopRemove = {
  type: "stop:remove";
  tripId: string;
  stopId: string;
};

export type StopRename = {
  type: "stop:rename";
  tripId: string;
  stopId: string;
  name: string;
};

export type StopReorder = {
  type: "stop:reorder";
  tripId: string;
  stopId: string;
  /** The stop that should end up directly ABOVE this one; null means top of the list. */
  beforeId: string | null;
  /** The stop that should end up directly BELOW this one; null means bottom. */
  afterId: string | null;
  /**
   * Client-generated id for this specific drag. The server echoes it back on the result
   * (or the error), which is how the originator matches the authoritative answer to the
   * optimistic move it already drew. Everyone else ignores it.
   */
  opId: string;
};

export type ClientMessage = PresenceHello | StopAdd | StopRemove | StopRename | StopReorder;

/* ------------------------------------------------------------------ server -> client */

export type TripState = {
  type: "trip:state";
  trip: Trip;
  /** Already ordered by rank. */
  stops: Stop[];
  users: string[];
};

export type StopAdded = { type: "stop:added"; stop: Stop };
export type StopRemoved = { type: "stop:removed"; stopId: string };
export type StopRenamed = { type: "stop:renamed"; stop: Stop };
/**
 * The moved stop carrying its new rank — clients re-sort by (rank, id) on receipt.
 * `opId` is present when this resulted from a client's reorder intent; only the client
 * that sent that opId reacts to it.
 */
export type StopReordered = { type: "stop:reordered"; stop: Stop; opId?: string };
export type PresenceUpdate = { type: "presence:update"; users: string[] };
/** `opId` is set when the failure was a reorder intent, so the sender can roll back. */
export type ErrorMessage = { type: "error"; message: string; opId?: string };

export type ServerMessage =
  | TripState
  | StopAdded
  | StopRemoved
  | StopRenamed
  | StopReordered
  | PresenceUpdate
  | ErrorMessage;

/** Every message type a client may send, for validation on the server. */
export const CLIENT_MESSAGE_TYPES = [
  "presence:hello",
  "stop:add",
  "stop:remove",
  "stop:rename",
  "stop:reorder",
] as const;
