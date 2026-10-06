"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useFx } from "@/features/player/fx-store";
import { activeLyricIndex, parseLyrics } from "@/features/player/lyrics";
import { usePlayer } from "@/features/player/player-store";
import { api, queryKeys } from "@/lib/api";
import { cn } from "@/lib/utils";

export function LyricsPanel() {
  const open = useFx((s) => s.lyricsOpen);
  const setOpen = useFx((s) => s.setLyricsOpen);
  const track = usePlayer((s) => s.track);
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const detail = useQuery({
    queryKey: queryKeys.track(track?.id ?? ""),
    queryFn: ({ signal }) => api.track(track?.id ?? "", signal),
    enabled: open && Boolean(track?.id),
    staleTime: 60_000,
  });
  const lyrics = detail.data?.lyrics ?? track?.lyrics;
  const lines = useMemo(() => parseLyrics(lyrics, durationMs), [lyrics, durationMs]);
  const active = activeLyricIndex(lines, positionMs);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, open]);

  return (
    <BottomSheet
      open={open}
      onClose={() => setOpen(false)}
      title={track?.title ?? "Lyrics"}
      description={detail.data?.artist || track?.artist || "Embedded lyrics"}
      className="max-w-xl"
    >
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {detail.isLoading ? "Loading lyrics…" : "This file has no lyrics tag."}
        </p>
      ) : (
        <ul ref={listRef} className="space-y-3 py-2">
          {lines.map((line, i) => (
            <li
              key={`${line.t}:${line.text}`}
              className={cn(
                "text-center text-lg transition-all duration-300 sm:text-xl",
                i === active ? "scale-105 font-semibold text-foreground" : "text-muted-foreground/70",
              )}
            >
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
