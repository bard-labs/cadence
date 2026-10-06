"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useFx } from "@/features/player/fx-store";
import { usePlayer } from "@/features/player/player-store";
import { serverClock } from "@/lib/realtime/clock";
import { useRealtime, useRoom } from "@/lib/realtime/store";

/** "Stats for nerds": clock, drift, codec — the matrix of sync health. */
export function StatsPanel() {
  const open = useFx((s) => s.statsOpen);
  const setOpen = useFx((s) => s.setStatsOpen);
  const p = usePlayer();
  const status = useRealtime((s) => s.status);
  const room = useRoom(p.mode === "listener" ? p.hostId : null);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setHistory((h) => {
        const next = [...h, p.driftMs ?? 0];
        return next.length > 48 ? next.slice(-48) : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [open, p.driftMs]);

  const t = p.track;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          role="dialog"
          aria-label="Sync stats"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 mx-auto w-full max-w-md overflow-hidden rounded-t-3xl border border-border/70 bg-card/95 p-4 font-mono text-xs shadow-2xl backdrop-blur-xl sm:bottom-24 sm:rounded-3xl"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-normal">Stats for nerds</h2>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={() => setOpen(false)}
              aria-label="Close stats"
            >
              <X />
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground">
            <Row k="socket" v={status} />
            <Row k="mode" v={p.mode} />
            <Row k="clock offset" v={`${Math.round(serverClock.offsetMs)} ms`} />
            <Row k="rtt" v={serverClock.rttMs != null ? `${Math.round(serverClock.rttMs)} ms` : "—"} />
            <Row k="drift" v={p.driftMs != null ? `${p.driftMs} ms` : "—"} />
            <Row k="seq" v={room?.seq ?? "—"} />
            <Row k="controllers" v={(room?.controllers ?? []).length} />
            <Row k="codec" v={t?.codec ?? "—"} />
            <Row k="sample rate" v={t?.sampleRate ? `${t.sampleRate} Hz` : "—"} />
            <Row k="channels" v={t?.channels ?? "—"} />
            <Row k="bitrate" v={t?.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : "—"} />
            <Row k="buffer" v={bufferLabel()} />
          </dl>
          <DriftSpark values={history} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <>
      <dt className="text-muted-foreground/70">{k}</dt>
      <dd className="truncate text-right text-foreground">{v}</dd>
    </>
  );
}

function DriftSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 280;
  const h = 48;
  const max = Math.max(80, ...values.map(Math.abs));
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h / 2 - (v / max) * (h / 2 - 4);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="mt-4">
      <p className="mb-1 text-[10px] tracking-wide text-muted-foreground/70 uppercase">Drift</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full text-live" aria-hidden>
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="currentColor" strokeOpacity="0.2" />
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />
      </svg>
    </div>
  );
}

function bufferLabel() {
  try {
    const a = document.querySelector("audio");
    if (!a || a.buffered.length === 0) return "—";
    const end = a.buffered.end(a.buffered.length - 1);
    const ahead = Math.max(0, end - a.currentTime);
    return `${ahead.toFixed(1)} s`;
  } catch {
    return "—";
  }
}
