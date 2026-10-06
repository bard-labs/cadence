// Wire protocol between the web app and services/core/internal/realtime.
// Keep in sync with services/core/internal/realtime/protocol.go.

/** Host playback at `capturedAt` (server clock, ms). */
export type RoomState = {
  trackId: string;
  positionMs: number;
  capturedAt: number;
  paused: boolean;
  rate: number;
};

/** Everything needed to render one person's room. `seq` only grows. */
export type RoomSnapshot = {
  seq: number;
  state: RoomState | null;
  listeners: number;
  online: boolean;
};

export type ClientMessage =
  | { type: "ping"; t0: number }
  | { type: "watch"; roomIds: string[] }
  | { type: "listen"; roomId: string }
  | { type: "leave" }
  | {
      type: "state";
      trackId: string;
      positionMs: number;
      paused: boolean;
      rate: number;
      capturedAt: number;
    }
  | { type: "stop" }
  | { type: "drift"; driftMs: number };

export type ServerMessage =
  | ({ type: "room"; roomId: string } & RoomSnapshot)
  | { type: "pong"; t0: number; ts: number }
  | { type: "listening"; roomId: string }
  | { type: "error"; code: string; message: string; roomId?: string };

export type ServerErrorCode =
  | "bad_message"
  | "unknown_type"
  | "internal"
  | "listen_invalid"
  | "listen_forbidden"
  | "listen_ended"
  | "invalid_state"
  | "track_unavailable";

/** Where the host is right now, given the server clock. */
export function expectedPositionMs(state: RoomState, serverNow: number): number {
  if (state.paused) return state.positionMs;
  return state.positionMs + Math.max(0, serverNow - state.capturedAt) * state.rate;
}
