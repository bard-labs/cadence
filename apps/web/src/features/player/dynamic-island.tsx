"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Activity, Mic2, Pause, Play, SlidersHorizontal, Square, X } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useState } from "react";

import { useLive } from "@/features/live/live-provider";
import { useFx } from "@/features/player/fx-store";
import { useTrackLyrics } from "@/features/player/lyrics-view";
import { usePlayer } from "@/features/player/player-store";
import { coverUrl } from "@/lib/artwork";
import { useRoom } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 520, damping: 38, mass: 0.7 };

/** Apple-style Dynamic Island — DJ mode only. Hover expands into controls. */
export function DynamicIsland() {
  const { engine, me } = useLive();
  const p = usePlayer();
  const fx = useFx();
  const { lines } = useTrackLyrics();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const open = hover || focus;
  const sharedRoom = useRoom(p.mode === "listener" ? p.hostId : null);
  const shared = p.mode === "listener" && (sharedRoom?.controllers ?? []).includes(me.id);
  const canDrive = p.mode === "host" || shared;
  const showPause = p.status === "playing" || p.status === "buffering";
  const art = p.track?.coverUrl || (p.track ? coverUrl(p.track.id, 80) : null);
  const hasLyrics = lines.length > 0;

  if (!fx.djOpen || p.mode === "idle") return null;

  return (
    <div className="pointer-events-none fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-[70] sm:right-5">
      <motion.div
        layout
        transition={spring}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        onFocusCapture={() => setFocus(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
        }}
        className="pointer-events-auto origin-top-right"
      >
        <motion.div
          layout
          transition={spring}
          className={cn(
            "overflow-hidden border border-white/10 bg-black text-white shadow-2xl shadow-black/50",
            open ? "rounded-[28px]" : "rounded-full",
          )}
          style={{
            boxShadow: open
              ? "0 18px 50px rgb(0 0 0 / 0.55), 0 0 40px oklch(0.55 0.22 320 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.08)"
              : "0 10px 30px rgb(0 0 0 / 0.45), 0 0 24px oklch(0.55 0.2 300 / 0.2), inset 0 1px 0 rgb(255 255 255 / 0.06)",
          }}
        >
          <motion.div layout="position" transition={spring} className="flex items-center gap-2.5 px-2.5 py-2">
            <motion.div
              layout
              className="relative size-7 shrink-0 overflow-hidden rounded-full bg-white/10"
              animate={showPause ? { scale: [1, 1.06, 1] } : { scale: 1 }}
              transition={showPause ? { repeat: Number.POSITIVE_INFINITY, duration: 1.6 } : spring}
            >
              {art?.startsWith("https://images.unsplash.com/") ? (
                <Image src={art} alt="" fill sizes="28px" className="object-cover" />
              ) : (
                art && (
                  // biome-ignore lint/performance/noImgElement: cover is served from object storage
                  <img src={art} alt="" className="size-full object-cover" />
                )
              )}
            </motion.div>
            <motion.div layout className="min-w-0 pr-1">
              <p className="max-w-[9rem] truncate text-[11px] font-medium leading-tight">
                {p.track?.title ?? "Cadence"}
              </p>
              {!open && <p className="text-[10px] leading-tight text-white/50">{showPause ? "Playing" : "Paused"}</p>}
            </motion.div>
            {showPause && !open && (
              <span className="mr-1 flex items-end gap-0.5" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-0.5 rounded-full bg-[oklch(0.78_0.18_320)]"
                    animate={{ height: [4, 12, 6, 14, 4] }}
                    transition={{ repeat: Number.POSITIVE_INFINITY, duration: 0.9, delay: i * 0.12 }}
                  />
                ))}
              </span>
            )}
          </motion.div>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="actions"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-3 gap-1.5 px-2.5 pb-2.5">
                  <IslandBtn
                    label={showPause ? "Pause" : "Play"}
                    onClick={() => void engine?.toggle()}
                    disabled={!(canDrive || p.status === "blocked")}
                  >
                    {showPause ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </IslandBtn>
                  <IslandBtn
                    label="Lyrics"
                    active={fx.djLyricsOverlay}
                    disabled={!hasLyrics}
                    onClick={() => fx.setDjLyricsOverlay(!fx.djLyricsOverlay)}
                  >
                    <Mic2 className="size-4" />
                  </IslandBtn>
                  <IslandBtn label="Exit" onClick={() => fx.setDjOpen(false)}>
                    <X className="size-4" />
                  </IslandBtn>
                  <IslandBtn label="Studio" active={fx.eqOpen} onClick={() => fx.setEqOpen(!fx.eqOpen)}>
                    <SlidersHorizontal className="size-4" />
                  </IslandBtn>
                  <IslandBtn label="Stats" active={fx.statsOpen} onClick={() => fx.setStatsOpen(!fx.statsOpen)}>
                    <Activity className="size-4" />
                  </IslandBtn>
                  <IslandBtn label="Stop" onClick={() => engine?.stop()}>
                    <Square className="size-3.5 fill-current" />
                  </IslandBtn>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}

function IslandBtn({
  children,
  label,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] transition-colors",
        "bg-white/6 hover:bg-white/12 disabled:opacity-40",
        active && "bg-[oklch(0.55_0.2_320_/0.35)] text-[oklch(0.88_0.12_320)]",
      )}
    >
      {children}
      <span className="leading-none">{label}</span>
    </button>
  );
}
