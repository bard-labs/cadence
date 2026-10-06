"use client";

import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { usePlayerStore } from "@/features/player/player-store";
import { cadenceApi } from "@/lib/api";

export default function LibraryPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => cadenceApi.me() });
  const tracks = useQuery({ queryKey: ["tracks"], queryFn: () => cadenceApi.listTracks(), refetchInterval: 5000 });
  const setTrack = usePlayerStore((s) => s.setTrack);

  return (
    <AppShell username={me.data?.username}>
      <h1 className="text-2xl font-semibold mb-6">Library</h1>
      <ul className="space-y-3">
        {(tracks.data ?? []).map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3"
          >
            <div>
              <p className="font-medium">{t.title}</p>
              <p className="text-xs text-zinc-500">{t.status}</p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={t.status !== "ready"}
              onClick={() => {
                setTrack(t);
                usePlayerStore.getState().setHost(me.data?.id ?? null, true);
              }}
            >
              Play
            </Button>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
