import { create } from "zustand";

import type { Track } from "@/lib/api";

type PlayerState = {
  currentTrack: Track | null;
  hostUserId: string | null;
  isHost: boolean;
  seq: number;
  setTrack: (track: Track | null) => void;
  setHost: (hostUserId: string | null, isHost: boolean) => void;
  bumpSeq: () => number;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  hostUserId: null,
  isHost: true,
  seq: 0,
  setTrack: (track) => set({ currentTrack: track }),
  setHost: (hostUserId, isHost) => set({ hostUserId, isHost }),
  bumpSeq: () => {
    const next = get().seq + 1;
    set({ seq: next });
    return next;
  },
}));
