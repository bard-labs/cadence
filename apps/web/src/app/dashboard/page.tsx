"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { AppShell } from "@/components/app-shell";
import SpatialProductShowcase from "@/components/ui/spatial-product-showcase";
import { AudioPlayer, becomeHost, joinListenAlong } from "@/features/player/audio-player";
import { usePlayerStore } from "@/features/player/player-store";
import { cadenceApi } from "@/lib/api";

export default function DashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => cadenceApi.me() });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => cadenceApi.listGroups() });
  const firstGroupId = groups.data?.[0]?.id;
  const groupDetail = useQuery({
    queryKey: ["group", firstGroupId],
    queryFn: () => cadenceApi.getGroup(firstGroupId!),
    enabled: Boolean(firstGroupId),
    refetchInterval: 5000,
  });

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const friendSession = useMemo(() => {
    const listening = groupDetail.data?.listening ?? [];
    return listening.find((s) => s.userId !== me.data?.id && s.trackId && !s.paused);
  }, [groupDetail.data, me.data?.id]);

  const showcaseData = useMemo(() => {
    const youTitle = currentTrack?.title ?? "Nothing playing";
    return {
      left: {
        title: youTitle,
        description: "You are the sync anchor when you play. Friends can listen along to your queue.",
        stats: { connectionStatus: "You", batteryLevel: 100 },
      },
      right: friendSession
        ? {
            title: friendSession.trackTitle ?? "Unknown track",
            description: `@${friendSession.username} is playing now. Join their room to stay in sync.`,
            stats: { connectionStatus: "In sync", batteryLevel: 88 },
            image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&q=80",
          }
        : undefined,
    };
  }, [friendSession, currentTrack?.title]);

  return (
    <AppShell username={me.data?.username}>
      <SpatialProductShowcase
        data={showcaseData}
        onListenAlong={() => {
          if (friendSession?.userId) joinListenAlong(friendSession.userId);
        }}
        listenAlongLabel="Listen along"
      />
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          className="text-sm text-zinc-400 hover:text-white"
          onClick={() => becomeHost()}
        >
          Host your own room
        </button>
      </div>
      <AudioPlayer />
    </AppShell>
  );
}
