"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, Radio, Volume2, VolumeX, X } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { SeekBar } from "@/components/ui/seek-bar";
import { Spinner } from "@/components/ui/spinner";
import { useLive } from "@/features/live/live-provider";
import { usePlayer } from "@/features/player/player-store";
import { coverUrl } from "@/lib/artwork";
import { cn } from "@/lib/utils";

export function PlayerBar() {
  const { engine } = useLive();
  const p = usePlayer();
  const visible = p.mode !== "idle";
  const isListener = p.mode === "listener";
  const busy = p.status === "loading" || p.status === "buffering";
  const showPause = p.status === "playing" || p.status === "buffering";
  const canToggle = p.mode === "host" ? p.track !== null && p.status !== "loading" : p.status === "blocked";

  const subtitle = isListener ? `Listening with @${p.hostName}` : p.track ? `@${p.track.uploaderUsername}` : "";

  return (
    <AnimatePresence>
      {visible && (
        <motion.section
          aria-label="Player"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 36 }}
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border/60 bg-background/90 backdrop-blur-xl sm:bottom-0 sm:pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:h-20 sm:gap-6 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:w-72 sm:flex-none">
              <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted sm:size-12">
                {p.track && <Image src={coverUrl(p.track.id, 160)} alt="" fill sizes="48px" className="object-cover" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {p.track?.title ?? (isListener ? "Waiting for host" : "")}
                </p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  {isListener && <Radio className="size-3 shrink-0 text-live" aria-hidden />}
                  <span className="truncate">{subtitle}</span>
                </p>
              </div>
            </div>

            <div className="hidden min-w-0 flex-1 flex-col items-center gap-1 sm:flex">
              <SeekBar
                positionMs={p.positionMs}
                durationMs={p.durationMs}
                onSeek={p.mode === "host" ? (ms) => engine?.seek(ms) : undefined}
              />
              <SyncLine />
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              {(p.mode === "host" || p.status === "blocked") && (
                <Button
                  size="icon-lg"
                  className="rounded-full"
                  onClick={() => engine?.toggle()}
                  disabled={!canToggle}
                  aria-label={showPause ? "Pause" : "Play"}
                >
                  {busy ? (
                    <Spinner className="text-primary-foreground" />
                  ) : showPause ? (
                    <Pause />
                  ) : (
                    <Play className="ml-0.5" />
                  )}
                </Button>
              )}
              {isListener && busy && <Spinner className="mx-2" label="Syncing" />}
              <VolumeControl />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => engine?.stop()}
                aria-label={isListener ? "Stop listening along" : "Close player"}
                title={isListener ? "Leave" : "Close"}
              >
                <X />
              </Button>
            </div>
          </div>
          <MobileProgress />
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function SyncLine() {
  const { mode, status, notice, driftMs } = usePlayer();
  const text =
    notice ??
    (mode === "listener" && status === "playing"
      ? driftMs !== null && Math.abs(driftMs) > 40
        ? `Syncing… ${driftMs > 0 ? "+" : ""}${driftMs} ms`
        : "In sync"
      : null);
  if (!text) return <span className="h-4" />;
  return (
    <span
      role="status"
      className={cn("h-4 truncate text-[11px]", status === "error" ? "text-destructive" : "text-muted-foreground")}
    >
      {text}
    </span>
  );
}

function MobileProgress() {
  const { positionMs, durationMs, notice, status } = usePlayer();
  const pct = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  return (
    <div className="sm:hidden">
      {notice && (
        <p
          className={cn(
            "truncate px-4 pb-1.5 text-[11px]",
            status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {notice}
        </p>
      )}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-white/5">
        <div className="h-full bg-foreground/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function VolumeControl() {
  const { engine } = useLive();
  const { volume, muted } = usePlayer();
  const level = muted ? 0 : volume;
  return (
    <div className="hidden items-center gap-2 md:flex">
      <Button variant="ghost" size="icon" onClick={() => engine?.toggleMute()} aria-label={muted ? "Unmute" : "Mute"}>
        {level === 0 ? <VolumeX /> : <Volume2 />}
      </Button>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={level}
        onChange={(e) => engine?.setVolume(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/15 accent-foreground [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
      />
    </div>
  );
}
