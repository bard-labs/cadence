"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { useLive } from "@/features/live/live-provider";
import { activeLyricIndex, parseLyrics } from "@/features/player/lyrics";
import { usePlayer } from "@/features/player/player-store";
import { api, queryKeys } from "@/lib/api";
import { useRoom } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  lineClassName?: string;
  /** When true, auto-scrolls the active line into view. */
  autoScroll?: boolean;
  /** Compact overlay: only a few lines around the active one. */
  overlay?: boolean;
};

export function useCanSeekLyrics() {
  const { me } = useLive();
  const mode = usePlayer((s) => s.mode);
  const hostId = usePlayer((s) => s.hostId);
  const room = useRoom(mode === "listener" ? hostId : null);
  if (mode === "host") return true;
  if (mode === "listener" && hostId) return (room?.controllers ?? []).includes(me.id);
  return false;
}

export function useTrackLyrics() {
  const track = usePlayer((s) => s.track);
  const durationMs = usePlayer((s) => s.durationMs);
  const detail = useQuery({
    queryKey: queryKeys.track(track?.id ?? ""),
    queryFn: ({ signal }) => api.track(track?.id ?? "", signal),
    enabled: Boolean(track?.id),
    staleTime: 60_000,
  });
  const lyrics = detail.data?.lyrics ?? track?.lyrics;
  const lines = useMemo(() => parseLyrics(lyrics, durationMs), [lyrics, durationMs]);
  return { lines, loading: detail.isLoading, artist: detail.data?.artist ?? track?.artist, track };
}

/** Synced lyrics list. Click a line to seek there when you control playback. */
export function LyricsView({ className, lineClassName, autoScroll = true, overlay = false }: Props) {
  const { engine } = useLive();
  const positionMs = usePlayer((s) => s.positionMs);
  const canSeek = useCanSeekLyrics();
  const { lines, loading } = useTrackLyrics();
  const active = activeLyricIndex(lines, positionMs);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!autoScroll || active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, autoScroll]);

  if (lines.length === 0) {
    return (
      <p className={cn("py-6 text-center text-sm text-muted-foreground", className)}>
        {loading ? "Loading lyrics…" : "This file has no lyrics tag."}
      </p>
    );
  }

  const visible = overlay
    ? lines.map((line, i) => ({ line, i })).filter(({ i }) => Math.abs(i - active) <= 2)
    : lines.map((line, i) => ({ line, i }));

  return (
    <ul ref={listRef} className={cn("space-y-3", className)}>
      {visible.map(({ line, i }) => {
        const isActive = i === active;
        return (
          <li key={`${line.t}:${line.text}`}>
            <button
              type="button"
              disabled={!canSeek}
              onClick={() => {
                if (!canSeek) return;
                engine?.seek(line.t);
              }}
              title={canSeek ? "Jump to this line" : undefined}
              className={cn(
                "w-full text-center transition-all duration-300",
                canSeek && "cursor-pointer hover:text-foreground",
                !canSeek && "cursor-default",
                isActive ? "scale-105 font-semibold text-foreground" : "text-muted-foreground/70",
                overlay ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
                lineClassName,
              )}
            >
              {line.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
