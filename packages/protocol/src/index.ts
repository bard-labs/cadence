export type WsPing = { type: "ping"; t0: number };
export type WsPong = { type: "pong"; t0: number; ts: number };
export type WsJoin = { type: "join"; hostUserId: string };
export type WsState = {
  type: "state";
  trackId: string;
  positionMs: number;
  paused: boolean;
  rate: number;
  seq: number;
};
export type WsDrift = { type: "drift"; driftMs: number };

export type PlaybackState = {
  hostUserId: string;
  trackId: string;
  positionMs: number;
  serverTs: number;
  paused: boolean;
  rate: number;
  seq: number;
};
