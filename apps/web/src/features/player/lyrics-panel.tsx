"use client";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useFx } from "@/features/player/fx-store";
import { LyricsView, useTrackLyrics } from "@/features/player/lyrics-view";

export function LyricsPanel() {
  const open = useFx((s) => s.lyricsOpen);
  const setOpen = useFx((s) => s.setLyricsOpen);
  const { track, artist } = useTrackLyrics();

  return (
    <BottomSheet
      open={open}
      onClose={() => setOpen(false)}
      title={track?.title ?? "Lyrics"}
      description={artist || "Tap a line to jump there"}
      className="max-w-xl"
    >
      <LyricsView />
    </BottomSheet>
  );
}
