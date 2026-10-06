"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useLive } from "@/features/live/live-provider";
import { prefersNativeHls } from "@/features/player/audio-graph";
import { EQ_BANDS, type EqPreset, useFx, type VisualMode } from "@/features/player/fx-store";
import { usePlayer } from "@/features/player/player-store";
import { cn } from "@/lib/utils";

const PRESETS: { id: EqPreset; label: string }[] = [
  { id: "flat", label: "Flat" },
  { id: "bass", label: "Bass" },
  { id: "vocal", label: "Vocal" },
  { id: "bright", label: "Bright" },
  { id: "cinema", label: "Cinema" },
];

const VISUALS: { id: VisualMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "bars", label: "Bars" },
  { id: "pulse", label: "Pulse" },
  { id: "matrix", label: "Matrix" },
];

export function StudioPanel() {
  const open = useFx((s) => s.eqOpen);
  const setEqOpen = useFx((s) => s.setEqOpen);
  const fx = useFx();
  const { engine } = useLive();
  const mode = usePlayer((s) => s.mode);

  const enableStudio = async (on: boolean) => {
    await engine?.unlock();
    if (on && typeof document !== "undefined") {
      const probe = document.createElement("audio");
      if (prefersNativeHls(probe)) {
        toast.message("Studio on iPhone", {
          description:
            "Effects use Web Audio, so background playback / Dynamic Island may pause while Studio is on. Turn Studio off for lock-screen listening.",
        });
      }
    }
    fx.setStudio(on);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          role="dialog"
          aria-label="Studio"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 mx-auto max-h-[min(70dvh,560px)] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-border/70 bg-card/95 p-4 shadow-2xl backdrop-blur-xl sm:bottom-24 sm:rounded-3xl sm:p-5"
        >
          <div className="mb-4 flex items-center gap-3">
            <div>
              <h2 className="text-base font-semibold">Studio</h2>
              <p className="text-xs text-muted-foreground">
                Optional. Off by default so Safari can keep playing in the background.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={() => setEqOpen(false)}
              aria-label="Close studio"
            >
              <X />
            </Button>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <ToggleChip
              on={fx.studioOn}
              onClick={() => void enableStudio(!fx.studioOn)}
              label={fx.studioOn ? "Studio on" : "Studio off"}
            />
            <Button variant="ghost" size="sm" onClick={() => fx.reset()}>
              <RotateCcw data-icon="inline-start" />
              Reset
            </Button>
          </div>

          <Section title="Equalizer">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => fx.applyPreset(p.id)}
                  disabled={!fx.studioOn}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
              {EQ_BANDS.map((f, i) => (
                <label key={f} className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={fx.bands[i]}
                    disabled={!fx.studioOn}
                    onChange={(e) => fx.setBand(i, Number(e.target.value))}
                    className="h-24 w-6 cursor-pointer appearance-none bg-transparent accent-live disabled:opacity-40 sm:h-28 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-live"
                    style={{ writingMode: "vertical-lr", direction: "rtl" }}
                    aria-label={`${f >= 1000 ? `${f / 1000}k` : f} Hz`}
                  />
                  <span>{f >= 1000 ? `${f / 1000}k` : f}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Tone label="Bass" value={fx.bass} onChange={(v) => fx.setTone("bass", v)} disabled={!fx.studioOn} />
              <Tone label="Mid" value={fx.mid} onChange={(v) => fx.setTone("mid", v)} disabled={!fx.studioOn} />
              <Tone
                label="Treble"
                value={fx.treble}
                onChange={(v) => fx.setTone("treble", v)}
                disabled={!fx.studioOn}
              />
            </div>
          </Section>

          <Section title="Effects">
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                on={fx.autoPan}
                onClick={() => fx.setAutoPan(!fx.autoPan)}
                label="8D pan"
                disabled={!fx.studioOn}
              />
              <ToggleChip on={fx.night} onClick={() => fx.setNight(!fx.night)} label="Night" disabled={!fx.studioOn} />
              <ToggleChip on={fx.lofi} onClick={() => fx.setLofi(!fx.lofi)} label="Lo-fi" disabled={!fx.studioOn} />
            </div>
            <label className="mt-3 flex items-center gap-3 text-sm">
              <span className="w-16 text-muted-foreground">Reverb</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={fx.reverb}
                disabled={!fx.studioOn}
                onChange={(e) => fx.setReverb(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-live disabled:opacity-40"
              />
            </label>
            {mode === "host" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="self-center text-xs text-muted-foreground">Tempo (shared)</span>
                {[
                  { r: 0.8, label: "Slowed" },
                  { r: 1, label: "1×" },
                  { r: 1.25, label: "Nightcore" },
                ].map((t) => (
                  <Button
                    key={t.r}
                    size="sm"
                    variant={fx.tempo === t.r ? "default" : "outline"}
                    className="h-7"
                    disabled={!fx.studioOn}
                    onClick={() => fx.setTempo(t.r)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Visualizer">
            <div className="flex flex-wrap gap-2">
              {VISUALS.map((v) => (
                <Button
                  key={v.id}
                  size="sm"
                  variant={fx.visual === v.id ? "default" : "outline"}
                  className="h-7"
                  onClick={() => {
                    void engine?.unlock();
                    fx.setVisual(v.id);
                  }}
                >
                  {v.label}
                </Button>
              ))}
            </div>
          </Section>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-border/50 bg-background/40 p-3 sm:p-4">
      <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Tone({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-12 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={-12}
        max={12}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-live disabled:opacity-40"
      />
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{value}</span>
    </label>
  );
}

function ToggleChip({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40",
        on ? "border-live/40 bg-live/15 text-live" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
