import type { RoomSnapshot } from "@bardlabs/cadence-protocol";
import { create } from "zustand";

import type { SocketStatus } from "@/lib/realtime/socket";

type RealtimeState = {
  status: SocketStatus;
  rooms: Record<string, RoomSnapshot>;
  setStatus: (status: SocketStatus) => void;
  /** Applies a snapshot unless an older one arrives after a newer one. */
  applyRoom: (roomId: string, snap: RoomSnapshot) => void;
  reset: () => void;
};

export const useRealtime = create<RealtimeState>((set) => ({
  status: "connecting",
  rooms: {},
  setStatus: (status) => set({ status }),
  applyRoom: (roomId, snap) =>
    set((s) => {
      const prev = s.rooms[roomId];
      if (prev && snap.seq < prev.seq) return s;
      return { rooms: { ...s.rooms, [roomId]: snap } };
    }),
  reset: () => set({ status: "connecting", rooms: {} }),
}));

export const useRoom = (roomId: string | null | undefined) =>
  useRealtime((s) => (roomId ? s.rooms[roomId] : undefined));
