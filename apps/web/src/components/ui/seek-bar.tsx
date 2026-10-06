"use client";

import { useState } from "react";

import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  positionMs: number;
  durationMs: number;
  /** Omit for a read-only bar (listeners follow the host). */
  onSeek?: (ms: number) => void;
  className?: string;
  label?: string;
};

/** Native range input for accessibility; seeks only on commit so drags don't flood the socket. */
export function SeekBar({ positionMs, durationMs, onSeek, className, label = "Seek" }: Props) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  const max = Math.max(durationMs, 1);
  const value = Math.min(dragMs ?? positionMs, max);
  const pct = (value / max) * 100;

  const commit = () => {
    if (dragMs !== null) onSeek?.(dragMs);
    setDragMs(null);
  };

  return (
    <div className={cn("flex w-full items-center gap-3 text-[11px] tabular-nums text-muted-foreground", className)}>
      <span className="w-10 text-right">{formatTime(value)}</span>
      <div className="group relative flex h-4 flex-1 items-center">
        <div className="absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
        {onSeek ? (
          <input
            type="range"
            aria-label={label}
            aria-valuetext={`${formatTime(value)} of ${formatTime(durationMs)}`}
            min={0}
            max={max}
            step={1000}
            value={value}
            onChange={(e) => setDragMs(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            className="absolute inset-0 h-4 w-full cursor-pointer appearance-none bg-transparent opacity-0 focus-visible:opacity-100 [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
          />
        ) : (
          <div
            role="progressbar"
            aria-label="Playback progress"
            aria-valuemin={0}
            aria-valuemax={Math.round(max / 1000)}
            aria-valuenow={Math.round(value / 1000)}
            className="absolute inset-0"
          />
        )}
        {onSeek && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-foreground opacity-0 shadow transition-opacity group-hover:opacity-100"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
      <span className="w-10">{formatTime(durationMs)}</span>
    </div>
  );
}
