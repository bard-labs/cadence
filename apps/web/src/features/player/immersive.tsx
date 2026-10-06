"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeekBar } from "@/components/ui/seek-bar";
import { Vinyl } from "@/features/listen/vinyl";
import { useLive } from "@/features/live/live-provider";
import { DynamicIsland } from "@/features/player/dynamic-island";
import { useFx } from "@/features/player/fx-store";
import { LyricsView, useTrackLyrics } from "@/features/player/lyrics-view";
import { usePlayer } from "@/features/player/player-store";
import { Visualizer } from "@/features/player/visualizer";
import { coverUrl, userHue } from "@/lib/artwork";
import { cn } from "@/lib/utils";

/** Full-screen DJ mode. Lyrics overlay is toggled from the Dynamic Island. */
export function ImmersivePlayer() {
  const open = useFx((s) => s.djOpen);
  const visual = useFx((s) => s.visual);
  const lyricsOn = useFx((s) => s.djLyricsOverlay);
  const { engine, me } = useLive();
  const p = usePlayer();
  const { lines } = useTrackLyrics();
  const showPause = p.status === "playing" || p.status === "buffering";
  const art = p.track?.coverUrl || (p.track ? coverUrl(p.track.id, 640) : null);
  const hue = userHue(me.id);
  const showLyrics = lyricsOn && lines.length > 0;

  return (
    <AnimatePresence>
      {open && p.mode !== "idle" && (
        <motion.div
          role="dialog"
          aria-label="DJ mode"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex flex-col bg-background"
        >
          <DynamicIsland />

          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="aura-glow absolute inset-0 opacity-90" />
            {art && (
              // biome-ignore lint/performance/noImgElement: blurred backdrop from dynamic cover
              <img src={art} alt="" className="size-full scale-125 object-cover opacity-20 blur-3xl" />
            )}
            {visual !== "off" && (
              <div className="absolute inset-0 opacity-70">
                <Visualizer hue={300} />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
          </div>

          <div className="relative z-10 flex shrink-0 items-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pr-28 sm:px-8">
            <p className="text-xs tracking-[0.2em] text-white/50 uppercase">DJ mode</p>
          </div>

          <div
            className={cn(
              "relative z-10 flex min-h-0 flex-1 flex-col items-center gap-6 px-6 pb-10",
              showLyrics
                ? "justify-start pt-2 md:flex-row md:items-center md:justify-center md:gap-12"
                : "justify-center",
            )}
          >
            <div className="flex w-full max-w-md flex-col items-center gap-6">
              <motion.div
                animate={p.status === "playing" ? { scale: [1, 1.02, 1] } : { scale: 1 }}
                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2.4, ease: "easeInOut" }}
              >
                <Vinyl
                  trackId={p.track?.id ?? null}
                  coverUrl={p.track?.coverUrl}
                  hue={hue}
                  spinning={p.status === "playing"}
                />
              </motion.div>

              <div className="w-full space-y-2 text-center">
                <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">{p.track?.title}</h1>
                <p className="truncate text-sm text-muted-foreground">
                  {[p.track?.artist, p.track?.album, p.track?.year].filter(Boolean).join(" · ") ||
                    (p.mode === "listener" ? `with @${p.hostName}` : `@${p.track?.uploaderUsername}`)}
                </p>
              </div>

              <div className="w-full space-y-4">
                <SeekBar positionMs={p.positionMs} durationMs={p.durationMs} onSeek={(ms) => engine?.seek(ms)} />
                <div className="flex items-center justify-center gap-4">
                  <Button
                    size="icon-lg"
                    className="size-16 rounded-full"
                    onClick={() => void engine?.toggle()}
                    aria-label={showPause ? "Pause" : "Play"}
                  >
                    {showPause ? <Pause className="size-7" /> : <Play className="ml-1 size-7" />}
                  </Button>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {showLyrics && (
                <motion.div
                  key="lyrics"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="pointer-events-auto w-full max-w-lg rounded-3xl border border-white/10 bg-black/40 px-4 py-6 shadow-[0_0_60px_oklch(0.5_0.2_320_/0.25)] backdrop-blur-md md:max-h-[70dvh] md:overflow-y-auto"
                >
                  <p className="mb-4 text-center text-[10px] tracking-[0.2em] text-white/45 uppercase">Lyrics</p>
                  <LyricsView overlay autoScroll={false} className="space-y-4" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
