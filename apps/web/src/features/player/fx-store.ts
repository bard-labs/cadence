import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Ten ISO-ish centre frequencies for the graphic EQ. */
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export type EqPreset = "flat" | "bass" | "vocal" | "bright" | "cinema";

export const EQ_PRESETS: Record<EqPreset, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 3, 1, 0, -1, -1, 0, 1, 2],
  vocal: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
  bright: [-1, 0, 0, 0, 1, 2, 3, 4, 5, 4],
  cinema: [4, 3, 1, 0, -1, 0, 1, 2, 3, 2],
};

export type VisualMode = "off" | "bars" | "matrix" | "pulse";

export type FxState = {
  /** Master: if false, the engine never builds a Web Audio graph (keeps iOS background HLS). */
  studioOn: boolean;
  bands: number[];
  bass: number;
  mid: number;
  treble: number;
  reverb: number;
  autoPan: boolean;
  night: boolean;
  lofi: boolean;
  /** Host-only tempo: 1, 0.8 (slowed), 1.25 (nightcore). */
  tempo: number;
  visual: VisualMode;
  djOpen: boolean;
  lyricsOpen: boolean;
  eqOpen: boolean;
  statsOpen: boolean;
  setStudio: (on: boolean) => void;
  setBand: (i: number, db: number) => void;
  setTone: (key: "bass" | "mid" | "treble", db: number) => void;
  setReverb: (v: number) => void;
  setAutoPan: (on: boolean) => void;
  setNight: (on: boolean) => void;
  setLofi: (on: boolean) => void;
  setTempo: (rate: number) => void;
  setVisual: (mode: VisualMode) => void;
  applyPreset: (p: EqPreset) => void;
  setDjOpen: (on: boolean) => void;
  setLyricsOpen: (on: boolean) => void;
  setEqOpen: (on: boolean) => void;
  setStatsOpen: (on: boolean) => void;
  reset: () => void;
};

const defaults = {
  studioOn: false,
  bands: [...EQ_PRESETS.flat],
  bass: 0,
  mid: 0,
  treble: 0,
  reverb: 0,
  autoPan: false,
  night: false,
  lofi: false,
  tempo: 1,
  visual: "off" as VisualMode,
  djOpen: false,
  lyricsOpen: false,
  eqOpen: false,
  statsOpen: false,
};

function clampDb(v: number) {
  return Math.max(-12, Math.min(12, Math.round(v * 10) / 10));
}

export const useFx = create<FxState>()(
  persist(
    (set) => ({
      ...defaults,
      setStudio: (studioOn) => set({ studioOn }),
      setBand: (i, db) =>
        set((s) => {
          if (i < 0 || i >= s.bands.length) return s;
          const bands = [...s.bands];
          bands[i] = clampDb(db);
          return { bands };
        }),
      setTone: (key, db) => set({ [key]: clampDb(db) }),
      setReverb: (reverb) => set({ reverb: Math.max(0, Math.min(1, reverb)) }),
      setAutoPan: (autoPan) => set({ autoPan }),
      setNight: (night) => set({ night }),
      setLofi: (lofi) => set({ lofi }),
      setTempo: (tempo) => set({ tempo: [0.8, 1, 1.25].includes(tempo) ? tempo : 1 }),
      setVisual: (visual) => set({ visual }),
      applyPreset: (p) => set({ bands: [...EQ_PRESETS[p]] }),
      setDjOpen: (djOpen) => set({ djOpen }),
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
      setEqOpen: (eqOpen) => set({ eqOpen }),
      setStatsOpen: (statsOpen) => set({ statsOpen }),
      reset: () => set({ ...defaults, bands: [...EQ_PRESETS.flat] }),
    }),
    {
      name: "cadence:fx",
      partialize: (s) => ({
        studioOn: s.studioOn,
        bands: s.bands,
        bass: s.bass,
        mid: s.mid,
        treble: s.treble,
        reverb: s.reverb,
        autoPan: s.autoPan,
        night: s.night,
        lofi: s.lofi,
        tempo: s.tempo,
        visual: s.visual,
      }),
    },
  ),
);

/** True when the engine must attach a MediaElementSource (breaks native iOS HLS background). */
export function needsAudioGraph(s: Pick<FxState, "studioOn" | "visual"> = useFx.getState()) {
  return s.studioOn || s.visual !== "off";
}
