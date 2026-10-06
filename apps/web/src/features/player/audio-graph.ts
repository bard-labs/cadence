import { EQ_BANDS, type FxState } from "@/features/player/fx-store";

/**
 * Optional Web Audio chain. Built only when the user turns Studio or a
 * visualizer on. Once built, it owns the <audio> element's output for the
 * life of the page — that is the Safari trade-off documented in ADR-011.
 */
export class AudioGraph {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private bands: BiquadFilterNode[] = [];
  private bass: BiquadFilterNode | null = null;
  private mid: BiquadFilterNode | null = null;
  private treble: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private panner: StereoPannerNode | null = null;
  private lofi: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private built = false;

  constructor(private readonly audio: HTMLAudioElement) {}

  get active() {
    return this.built;
  }

  getAnalyser() {
    return this.analyser;
  }

  async ensure(): Promise<boolean> {
    if (this.built) {
      await this.resume();
      return true;
    }
    try {
      const AC =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.source = ctx.createMediaElementSource(this.audio);

      this.bands = EQ_BANDS.map((f) => {
        const n = ctx.createBiquadFilter();
        n.type = f <= 64 ? "lowshelf" : f >= 8000 ? "highshelf" : "peaking";
        n.frequency.value = f;
        n.Q.value = 1.1;
        n.gain.value = 0;
        return n;
      });
      this.bass = ctx.createBiquadFilter();
      this.bass.type = "lowshelf";
      this.bass.frequency.value = 120;
      this.mid = ctx.createBiquadFilter();
      this.mid.type = "peaking";
      this.mid.frequency.value = 1000;
      this.mid.Q.value = 0.7;
      this.treble = ctx.createBiquadFilter();
      this.treble.type = "highshelf";
      this.treble.frequency.value = 4000;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = 0;
      this.compressor.knee.value = 0;
      this.compressor.ratio.value = 1;
      this.compressor.attack.value = 0.01;
      this.compressor.release.value = 0.25;

      this.dry = ctx.createGain();
      this.wet = ctx.createGain();
      this.wet.gain.value = 0;
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = impulse(ctx, 2.2, 2.8);

      this.panner = ctx.createStereoPanner();
      this.lfoGain = ctx.createGain();
      this.lfoGain.gain.value = 0;
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 0.12;
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.panner.pan);
      this.lfo.start();

      this.lofi = ctx.createBiquadFilter();
      this.lofi.type = "lowpass";
      this.lofi.frequency.value = 22_000;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // source -> EQ bands -> tone -> compressor -> (dry|wet) -> panner -> lofi -> analyser -> out
      let node: AudioNode = this.source;
      for (const b of this.bands) {
        node.connect(b);
        node = b;
      }
      node.connect(this.bass);
      this.bass.connect(this.mid);
      this.mid.connect(this.treble);
      this.treble.connect(this.compressor);
      this.compressor.connect(this.dry);
      this.compressor.connect(this.wet);
      this.wet.connect(this.convolver);
      this.convolver.connect(this.panner);
      this.dry.connect(this.panner);
      this.panner.connect(this.lofi);
      this.lofi.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.built = true;
      await this.resume();
      return true;
    } catch {
      this.teardown();
      return false;
    }
  }

  apply(s: FxState) {
    if (!this.built || !this.ctx) return;
    for (let i = 0; i < this.bands.length; i++) this.bands[i].gain.value = s.bands[i] ?? 0;
    if (this.bass) this.bass.gain.value = s.bass;
    if (this.mid) this.mid.gain.value = s.mid;
    if (this.treble) this.treble.gain.value = s.treble;
    if (this.dry && this.wet) {
      this.wet.gain.value = s.reverb;
      this.dry.gain.value = 1 - s.reverb * 0.7;
    }
    if (this.lfoGain) this.lfoGain.gain.value = s.autoPan ? 0.85 : 0;
    if (this.panner && !s.autoPan) this.panner.pan.value = 0;
    if (this.compressor) {
      if (s.night) {
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 4;
      } else {
        this.compressor.threshold.value = 0;
        this.compressor.knee.value = 0;
        this.compressor.ratio.value = 1;
      }
    }
    if (this.lofi) this.lofi.frequency.value = s.lofi ? 3200 : 22_000;
  }

  async resume() {
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => {});
  }

  teardown() {
    try {
      this.lfo?.stop();
    } catch {}
    try {
      this.source?.disconnect();
    } catch {}
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.source = null;
    this.bands = [];
    this.bass = this.mid = this.treble = null;
    this.compressor = this.dry = this.wet = this.convolver = null;
    this.panner = this.lofi = this.analyser = this.lfo = this.lfoGain = null;
    this.built = false;
  }
}

/** Cheap synthetic room impulse — good enough for a wet send, no asset fetch. */
function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buf;
}

/** Tiny silent WAV, played inside a click handler to unlock iOS autoplay. */
export const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

export function prefersNativeHls(audio: HTMLAudioElement): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const apple = /iPhone|iPad|iPod|Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Edg/.test(ua);
  return apple && Boolean(audio.canPlayType("application/vnd.apple.mpegurl"));
}
