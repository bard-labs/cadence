"use client";

import { useEffect, useRef } from "react";

import { useLive } from "@/features/live/live-provider";
import { useFx, type VisualMode } from "@/features/player/fx-store";
import { usePlayer } from "@/features/player/player-store";
import { cn } from "@/lib/utils";

/** Canvas that paints from a real AnalyserNode, or a synthetic pulse when Studio is off. */
export function Visualizer({ mode, className, hue = 280 }: { mode?: VisualMode; className?: string; hue?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { engine } = useLive();
  const playing = usePlayer((s) => s.status === "playing" || s.status === "buffering");
  const visual = useFx((s) => s.visual);
  const active = mode ?? visual;

  useEffect(() => {
    if (active === "off") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let tick = 0;
    const buf = new Uint8Array(128);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      tick++;
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      const analyser = engine?.getAnalyser() ?? null;
      if (analyser) analyser.getByteFrequencyData(buf);
      else {
        for (let i = 0; i < buf.length; i++) {
          const wave = Math.sin(tick / 18 + i / 8) * 0.5 + 0.5;
          buf[i] = playing ? Math.floor(40 + wave * 160 * (1 - i / buf.length)) : 12;
        }
      }
      if (active === "bars") drawBars(ctx, buf, width, height, hue);
      else if (active === "matrix") drawMatrix(ctx, buf, width, height, tick, hue);
      else drawPulse(ctx, buf, width, height, hue);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, engine, playing, hue]);

  if (active === "off") return null;
  return <canvas ref={canvasRef} className={cn("pointer-events-none size-full", className)} aria-hidden />;
}

function drawBars(ctx: CanvasRenderingContext2D, buf: Uint8Array, w: number, h: number, hue: number) {
  const n = 48;
  const gap = 2;
  const bw = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const v = buf[Math.floor((i / n) * buf.length)] / 255;
    const bh = Math.max(2, v * h * 0.92);
    const x = i * (bw + gap);
    const g = ctx.createLinearGradient(0, h - bh, 0, h);
    g.addColorStop(0, `oklch(0.85 0.18 ${hue})`);
    g.addColorStop(1, `oklch(0.45 0.12 ${hue} / 0.4)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, h - bh, bw, bh);
  }
}

function drawPulse(ctx: CanvasRenderingContext2D, buf: Uint8Array, w: number, h: number, hue: number) {
  let sum = 0;
  for (let i = 0; i < 24; i++) sum += buf[i];
  const energy = sum / (24 * 255);
  const r = Math.min(w, h) * (0.18 + energy * 0.28);
  const cx = w / 2;
  const cy = h / 2;
  const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
  g.addColorStop(0, `oklch(0.9 0.2 ${hue} / ${0.35 + energy * 0.4})`);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `oklch(0.85 0.16 ${hue} / 0.7)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

const glyphs = "01アイウエオカキクケコΣΔΨΩ#*+";

function drawMatrix(ctx: CanvasRenderingContext2D, buf: Uint8Array, w: number, h: number, tick: number, hue: number) {
  ctx.fillStyle = "rgb(0 0 0 / 0.18)";
  ctx.fillRect(0, 0, w, h);
  const cols = Math.floor(w / 14);
  ctx.font = "12px ui-monospace, monospace";
  for (let c = 0; c < cols; c++) {
    const v = buf[c % buf.length] / 255;
    const rows = Math.floor(3 + v * 14);
    for (let r = 0; r < rows; r++) {
      const y = ((tick * (0.6 + (c % 5) * 0.15) + r * 14 + c * 7) % (h + 40)) - 20;
      const ch = glyphs[(c * 13 + r * 7 + (tick >> 2)) % glyphs.length];
      ctx.fillStyle = `oklch(${0.55 + v * 0.35} 0.2 ${hue} / ${0.35 + v * 0.55})`;
      ctx.fillText(ch, c * 14, y);
    }
  }
}
