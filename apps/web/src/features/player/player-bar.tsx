"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, Radio, Volume2, VolumeX, X } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { SeekBar } from "@/components/ui/seek-bar";
import { Spinner } from "@/components/ui/spinner";
import { useLive } from "@/features/live/live-provider";
import { DynamicIsland } from "@/features/player/dynamic-island";
import { useFx } from "@/features/player/fx-store";
import { PlayerHotkeys } from "@/features/player/hotkeys";
import { ImmersivePlayer } from "@/features/player/immersive";
import { LyricsPanel } from "@/features/player/lyrics-panel";
import { usePlayer } from "@/features/player/player-store";
import { StatsPanel } from "@/features/player/stats-panel";
import { StudioPanel } from "@/features/player/studio-panel";
import { Visualizer } from "@/features/player/visualizer";
import { coverUrl, userHue } from "@/lib/artwork";
import { useRoom } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

export function PlayerBar() {
  const { engine, me } = useLive();
  const p = usePlayer();
  const fx = useFx();
  const sharedRoom = useRoom(p.mode === "listener" ? p.hostId : null);
  const visible = p.mode !== "idle";
  const isListener = p.mode === "listener";
  const shared = isListener && (sharedRoom?.controllers ?? []).includes(me.id);
  const canDrive = p.mode === "host" || shared;
  const busy = p.status === "loading" || p.status === "buffering";
  const showPause = p.status === "playing" || p.status === "buffering";
  const canToggle = canDrive ? p.track !== null && p.status !== "loading" : p.status === "blocked";
  const art = p.track?.coverUrl || (p.track ? coverUrl(p.track.id, 160) : null);

  const credit = p.track?.artist || (p.track ? `@${p.track.uploaderUsername}` : "");
  const subtitle = isListener ? `${shared ? "In control · " : ""}Listening with @${p.hostName}` : credit;

  return (
    <>
      <PlayerHotkeys />
      <DynamicIsland />
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
            {fx.visual !== "off" && (
              <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 opacity-70">
                <Visualizer hue={userHue(me.id)} />
              </div>
            )}
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:h-20 sm:gap-6 sm:px-6">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left sm:w-72 sm:flex-none"
                onClick={() => fx.setDjOpen(true)}
                aria-label="Open DJ mode"
              >
                <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted sm:size-12">
                  {art?.startsWith("https://images.unsplash.com/") ? (
                    <Image src={art} alt="" fill sizes="48px" className="object-cover" />
                  ) : (
                    art && (
                      // biome-ignore lint/performance/noImgElement: cover is served from object storage
                      <img src={art} alt="" className="size-full object-cover" />
                    )
                  )}
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
              </button>

              <div className="hidden min-w-0 flex-1 flex-col items-center gap-1 sm:flex">
                <SeekBar
                  positionMs={p.positionMs}
                  durationMs={p.durationMs}
                  onSeek={canDrive ? (ms) => engine?.seek(ms) : undefined}
                />
                <SyncLine />
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1">
                {(canDrive || p.status === "blocked") && (
                  <Button
                    size="icon-lg"
                    className="rounded-full"
                    onClick={() => void engine?.toggle()}
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
      <StudioPanel />
      <LyricsPanel />
      <StatsPanel />
      <ImmersivePlayer />
    </>
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
