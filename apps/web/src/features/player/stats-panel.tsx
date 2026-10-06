"use client";

import { useEffect, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
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
    <BottomSheet open={open} onClose={() => setOpen(false)} title="Stats for nerds" className="font-mono text-xs">
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
    </BottomSheet>
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
