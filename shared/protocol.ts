/**
 * The wire protocol, shared by the browser and the server.
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
/** The moved stop carrying its new rank — clients re-sort by rank on receipt. */
export type StopReordered = { type: "stop:reordered"; stop: Stop };
export type PresenceUpdate = { type: "presence:update"; users: string[] };
export type ErrorMessage = { type: "error"; message: string };

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
