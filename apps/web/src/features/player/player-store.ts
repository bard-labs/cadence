import { create } from "zustand";

import type { Track } from "@/lib/api";

export type PlayerMode = "idle" | "host" | "listener";

/**
 * - `waiting`: listening along, but the host is paused, stopped or offline.
 * - `blocked`: the browser refused autoplay, or the user paused locally; a tap resyncs.
 */
export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "buffering" | "waiting" | "blocked" | "error";

type PlayerState = {
  mode: PlayerMode;
  status: PlayerStatus;
  track: Track | null;
  hostId: string | null;
  hostName: string | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  driftMs: number | null;
  notice: string | null;
};

export const initialPlayerState: Omit<PlayerState, "volume" | "muted"> = {
  mode: "idle",
  status: "idle",
  track: null,
  hostId: null,
  hostName: null,
  positionMs: 0,
  durationMs: 0,
  driftMs: null,
  notice: null,
};

export const usePlayer = create<PlayerState>(() => ({
  ...initialPlayerState,
  volume: 0.8,
  muted: false,
}));

export const setPlayer = (patch: Partial<PlayerState>) => usePlayer.setState(patch);
