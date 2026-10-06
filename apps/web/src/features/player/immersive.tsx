"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeekBar } from "@/components/ui/seek-bar";
import { Vinyl } from "@/features/listen/vinyl";
import { useLive } from "@/features/live/live-provider";
import { useFx } from "@/features/player/fx-store";
import { LyricsView, useTrackLyrics } from "@/features/player/lyrics-view";
import { usePlayer } from "@/features/player/player-store";
import { Visualizer } from "@/features/player/visualizer";
import { coverUrl, userHue } from "@/lib/artwork";
import { cn } from "@/lib/utils";

/** Full-screen DJ / now-playing mode with lyrics overlay when the file has them. */
export function ImmersivePlayer() {
  const open = useFx((s) => s.djOpen);
  const setOpen = useFx((s) => s.setDjOpen);
  const visual = useFx((s) => s.visual);
  const { engine, me } = useLive();
  const p = usePlayer();
  const { lines } = useTrackLyrics();
  const showPause = p.status === "playing" || p.status === "buffering";
  const art = p.track?.coverUrl || (p.track ? coverUrl(p.track.id, 640) : null);
  const hue = userHue(me.id);
  const hasLyrics = lines.length > 0;

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
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {art && (
              // biome-ignore lint/performance/noImgElement: blurred backdrop from dynamic cover
              <img src={art} alt="" className="size-full scale-125 object-cover opacity-25 blur-3xl" />
            )}
            {visual !== "off" && (
              <div className="absolute inset-0 opacity-80">
                <Visualizer hue={hue} />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-background/55 via-background/35 to-background/75" />
          </div>

          <div className="relative z-10 flex shrink-0 items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pr-24 sm:px-8 sm:pr-28">
            <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">DJ mode</p>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Exit DJ mode">
              <X />
            </Button>
          </div>

          <div
            className={cn(
              "relative z-10 flex min-h-0 flex-1 flex-col items-center gap-6 px-6 pb-10",
              hasLyrics
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

            {hasLyrics && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="pointer-events-auto w-full max-w-lg rounded-3xl border border-white/10 bg-black/35 px-4 py-6 backdrop-blur-md md:max-h-[70dvh] md:overflow-y-auto"
              >
                <p className="mb-4 text-center text-[10px] tracking-[0.2em] text-white/45 uppercase">Lyrics</p>
                <LyricsView overlay autoScroll={false} className="space-y-4" />
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
