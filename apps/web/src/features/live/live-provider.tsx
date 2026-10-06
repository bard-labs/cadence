"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlayerEngine } from "@/features/player/engine";
import { api, type Friend, queryKeys, type User } from "@/lib/api";
import { env } from "@/lib/env";
import { CadenceSocket } from "@/lib/realtime/socket";
import { useRealtime } from "@/lib/realtime/store";

type LiveContext = { me: User; engine: PlayerEngine | null };

const Ctx = createContext<LiveContext | null>(null);

export function useLive() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLive must be used inside <LiveProvider>");
  return ctx;
}

export function useFriends() {
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: ({ signal }) => api.friends(signal),
    refetchInterval: 15_000,
  });
}

/** Socket + player for signed-in pages. Mounted once by the (app) layout. */
export function LiveProvider({ me, children }: { me: User; children: ReactNode }) {
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<CadenceSocket | null>(null);
  const watchRef = useRef<string[]>([]);
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const friends = useFriends();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let eng: PlayerEngine | null = null;

    const socket = new CadenceSocket(env.wsUrl, {
      onStatus: (s) => useRealtime.getState().setStatus(s),
      onOpen: () => {
        socket.send({ type: "watch", roomIds: watchRef.current });
        eng?.onSocketOpen();
      },
      onMessage: (msg) => {
        if (msg.type === "room") {
          const { type: _type, roomId, ...snap } = msg;
          useRealtime.getState().applyRoom(roomId, snap);
        } else if (msg.type === "error") {
          if (!eng?.onServerError(msg) && process.env.NODE_ENV !== "production") {
            console.warn("[cadence] server error", msg);
          }
        } else if (msg.type === "control_request") {
          toast(`${msg.username} wants control`, {
            id: `control:${msg.from}`,
            description: "They'll be able to play, pause, seek, and change the track.",
            duration: 60_000,
            action: { label: "Accept", onClick: () => eng?.respondControl(msg.from, true) },
            cancel: { label: "Decline", onClick: () => eng?.respondControl(msg.from, false) },
          });
        } else if (msg.type === "control_result") {
          toast.dismiss(`control:${msg.roomId}`);
          if (msg.accepted) toast.success("You have control. Play, pause, and seek will move their room.");
          else toast("Control was declined.");
        } else if (msg.type === "control_revoked") {
          toast("Control ended.");
        }
      },
      onRepeatedFailure: () => {
        // A 401 here means the session ended; the API client redirects to /login.
        void api.me().catch(() => {});
      },
    });

    eng = new PlayerEngine(audio, {
      meId: me.id,
      send: (m) => socket.send(m),
      fetchTrack: (id) =>
        queryClient.fetchQuery({
          queryKey: queryKeys.track(id),
          queryFn: ({ signal }) => api.track(id, signal),
          staleTime: 60_000,
        }),
      getRoom: (id) => useRealtime.getState().rooms[id],
    });

    const unsubscribe = useRealtime.subscribe((state, prev) => {
      if (state.rooms === prev.rooms) return;
      for (const id of Object.keys(state.rooms)) {
        if (state.rooms[id] !== prev.rooms[id]) eng?.onRoomChange(id);
      }
    });

    socketRef.current = socket;
    socket.start();
    setEngine(eng);

    return () => {
      unsubscribe();
      socket.stop();
      eng?.destroy();
      socketRef.current = null;
      useRealtime.getState().reset();
      setEngine(null);
    };
  }, [queryClient, me.id]);

  const friendIds = useMemo(() => (friends.data ?? []).map((f) => f.userId).sort(), [friends.data]);
  const friendKey = friendIds.join(",");

  useEffect(() => {
    watchRef.current = friendKey ? friendKey.split(",") : [];
    socketRef.current?.send({ type: "watch", roomIds: watchRef.current });
  }, [friendKey]);

  useEffect(() => {
    if (!friends.data) return;
    seedRooms(friends.data);
  }, [friends.data]);

  const value = useMemo(() => ({ me, engine }), [me, engine]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* biome-ignore lint/a11y/useMediaCaption: music has no captions */}
      <audio ref={audioRef} className="hidden" />
    </Ctx.Provider>
  );
}

/** Friends' live rooms from REST, so tabs render before the socket catches up. */
function seedRooms(friends: Friend[]) {
  const { rooms, applyRoom } = useRealtime.getState();
  for (const f of friends) {
    if (!rooms[f.userId]) applyRoom(f.userId, f.live);
  }
}
