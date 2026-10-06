"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
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
    <AnimatePresence>
      {open && (
        <motion.aside
          role="dialog"
          aria-label="Lyrics"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[min(65dvh,520px)] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl sm:bottom-24 sm:rounded-3xl"
        >
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{track?.title ?? "Lyrics"}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {detail.data?.artist || track?.artist || "Embedded lyrics"}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close lyrics">
              <X />
            </Button>
          </div>
          {lines.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {detail.isLoading ? "Loading lyrics…" : "This file has no lyrics tag."}
            </p>
          ) : (
            <ul ref={listRef} className="scrollbar-none flex-1 space-y-3 overflow-y-auto px-5 py-6">
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
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
