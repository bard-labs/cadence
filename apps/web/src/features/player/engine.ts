import {
  type ClientMessage,
  expectedPositionMs,
  type RoomSnapshot,
  type RoomState,
  type ServerMessage,
} from "@bardlabs/cadence-protocol";
import type Hls from "hls.js";
import { toast } from "sonner";

import { AudioGraph, prefersNativeHls, SILENT_WAV } from "@/features/player/audio-graph";
import { needsAudioGraph, useFx } from "@/features/player/fx-store";
import { initialPlayerState, setPlayer, usePlayer } from "@/features/player/player-store";
import { errorMessage, type Track } from "@/lib/api";
import { serverClock } from "@/lib/realtime/clock";

const HARD_SEEK_MS = 400;
const NUDGE_MS = 40;
const MAX_NUDGE = 0.03;
const HEARTBEAT_MS = 5_000;
const DRIFT_TICK_MS = 1_000;
const DRIFT_REPORT_EVERY = 5;
const VOLUME_KEY = "cadence:volume";

type Deps = {
  send: (msg: ClientMessage) => boolean;
  fetchTrack: (id: string) => Promise<Track>;
  getRoom: (id: string) => RoomSnapshot | undefined;
  meId: string;
};

class StaleLoad extends Error {}

/**
 * Owns the single <audio> element.
 *
 * Host mode: local controls drive playback and every change is published as a
 * RoomState stamped with server time. Listener mode: playback follows the host's
 * RoomState; small drift is corrected by nudging playbackRate, large drift by seeking.
 */
export class PlayerEngine {
  private hls: Hls | null = null;
  private loadedTrackId: string | null = null;
  private loadingTrackId: string | null = null;
  private loadToken = 0;
  private syncToken = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private driftTicks = 0;
  /** Pause/play calls made by the engine, so their events aren't mistaken for the user. */
  private expectPause = 0;
  private expectPlay = 0;
  private userPaused = false;
  private lastTimeUpdate = 0;
  /** Media events fired while applying someone else's state must not be published back. */
  private publishLocks = 0;
  private remoteToken = 0;
  private graph: AudioGraph;
  private unlocked = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly deps: Deps,
  ) {
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    const volume = Number.isFinite(saved) && saved > 0 && saved <= 1 ? saved : 0.8;
    audio.volume = volume;
    setPlayer({ volume, muted: audio.muted });
    this.graph = new AudioGraph(audio);

    this.on("play", this.onPlay);
    this.on("pause", this.onPause);
    this.on("playing", () => {
      this.publish();
      setPlayer({ status: "playing", notice: null });
      this.updatePositionState();
    });
    this.on("waiting", () => {
      if (!this.audio.paused) setPlayer({ status: "buffering" });
    });
    this.on("seeked", () => this.publish());
    this.on("ratechange", () => this.publish());
    this.on("ended", this.onEnded);
    this.on("timeupdate", this.onTimeUpdate);
    this.on("durationchange", () => {
      if (Number.isFinite(audio.duration)) setPlayer({ durationMs: audio.duration * 1000 });
      this.updatePositionState();
    });
    this.on("volumechange", () => setPlayer({ volume: audio.volume, muted: audio.muted }));
    this.on("error", () => {
      if (!this.loadedTrackId) return;
      setPlayer({ status: "error", notice: "Playback failed. Try playing the track again." });
    });
    this.setupMediaSession();
    this.cleanup.push(useFx.subscribe((s) => void this.syncFx(s)));
  }

  destroy() {
    this.stopTimers();
    this.unload();
    this.graph.teardown();
    for (const fn of this.cleanup) fn();
    usePlayer.setState(initialPlayerState);
  }

  getAnalyser() {
    return this.graph.getAnalyser();
  }

  /** Must run inside a click/tap handler before iOS will allow autoplay. */
  async unlock() {
    if (this.unlocked) {
      await this.graph.resume();
      return;
    }
    try {
      const a = new Audio(SILENT_WAV);
      a.setAttribute("playsinline", "true");
      await a.play();
      a.pause();
      this.unlocked = true;
    } catch {
      // Still try; some browsers unlock on the real play() later.
    }
    await this.graph.resume();
  }

  private async syncFx(s = useFx.getState()) {
    if (!needsAudioGraph(s)) {
      if (this.graph.active)
        this.graph.apply({
          ...s,
          studioOn: false,
          visual: "off",
          reverb: 0,
          autoPan: false,
          night: false,
          lofi: false,
          bass: 0,
          mid: 0,
          treble: 0,
          bands: s.bands.map(() => 0),
        });
      return;
    }
    const ok = await this.graph.ensure();
    if (!ok) {
      toast.error("Studio mode needs Web Audio. Try Chrome or another browser.");
      useFx.getState().setStudio(false);
      useFx.getState().setVisual("off");
      return;
    }
    this.graph.apply(s);
    if (usePlayer.getState().mode === "host" && s.tempo !== this.audio.playbackRate) {
      try {
        // Nightcore / slowed: pitch follows rate on purpose.
        (this.audio as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = false;
        this.audio.playbackRate = s.tempo;
      } catch {
        this.audio.playbackRate = s.tempo;
      }
      this.publish();
    }
  }

  // ---- Host ---------------------------------------------------------------

  async playTrack(track: Track) {
    if (track.status !== "ready" || !track.manifestUrl) {
      toast.error("That track isn't ready to play yet.");
      return;
    }
    const mode = usePlayer.getState().mode;
    if (mode === "listener" && this.controllingHost()) {
      this.publishControlled({ trackId: track.id, positionMs: 0, paused: false });
      return;
    }
    if (mode === "listener") this.deps.send({ type: "leave" });
    if (mode === "host" && this.loadedTrackId === track.id) {
      this.seek(0);
      void this.playQuiet();
      return;
    }
    this.syncToken++;
    this.stopTimers();
    await this.unlock();
    setPlayer({ mode: "host", hostId: null, hostName: null, driftMs: null, notice: null });
    try {
      await this.load(track);
    } catch (err) {
      if (err instanceof StaleLoad) return;
      setPlayer({ status: "error", notice: errorMessage(err, "Couldn't load this track.") });
      return;
    }
    this.heartbeat = setInterval(() => {
      if (!this.audio.paused) this.publish();
    }, HEARTBEAT_MS);
    await this.playQuiet();
  }

  async toggle() {
    await this.unlock();
    const { mode, status } = usePlayer.getState();
    if (mode === "listener" && this.controllingHost()) {
      if (this.audio.paused || this.audio.ended) {
        const positionMs = this.audio.ended ? 0 : Math.round(this.audio.currentTime * 1000);
        if (this.audio.ended) this.audio.currentTime = 0;
        this.userPaused = false;
        void this.playQuiet();
        this.publishControlled({ paused: false, positionMs });
      } else {
        this.pauseQuiet();
        this.publishControlled({ paused: true });
      }
      return;
    }
    if (mode === "listener") {
      if (status === "blocked") this.resync();
      return;
    }
    if (mode !== "host") return;
    if (this.audio.paused) {
      if (this.audio.ended) this.audio.currentTime = 0;
      void this.playQuiet();
    } else {
      this.audio.pause();
    }
  }

  seek(ms: number) {
    if (usePlayer.getState().mode === "listener" && this.controllingHost() && this.loadedTrackId) {
      this.seekQuiet(ms);
      this.publishControlled({ positionMs: Math.round(ms), paused: this.audio.paused });
      setPlayer({ positionMs: ms });
      return;
    }
    if (usePlayer.getState().mode !== "host" || !this.loadedTrackId) return;
    const max = Number.isFinite(this.audio.duration) ? this.audio.duration : Number.POSITIVE_INFINITY;
    this.audio.currentTime = Math.min(Math.max(0, ms / 1000), max);
    setPlayer({ positionMs: this.audio.currentTime * 1000 });
  }

  stop() {
    const { mode } = usePlayer.getState();
    if (mode === "host") this.deps.send({ type: "stop" });
    if (mode === "listener") this.deps.send({ type: "leave" });
    this.syncToken++;
    this.stopTimers();
    this.unload();
    setPlayer({ ...initialPlayerState });
  }

  /** Host id of the room this listener is allowed to drive, or null. */
  private controllingHost(): string | null {
    const { mode, hostId } = usePlayer.getState();
    if (mode !== "listener" || !hostId) return null;
    const controllers = this.deps.getRoom(hostId)?.controllers ?? [];
    return controllers.includes(this.deps.meId) ? hostId : null;
  }

  private publishControlled(over: { trackId?: string; positionMs?: number; paused?: boolean }) {
    const hostId = this.controllingHost();
    const trackId = over.trackId ?? this.loadedTrackId;
    if (!hostId || !trackId) return;
    this.deps.send({
      type: "state",
      roomId: hostId,
      trackId,
      positionMs: over.positionMs ?? Math.round(this.audio.currentTime * 1000),
      paused: over.paused ?? this.audio.paused,
      rate: this.audio.playbackRate,
      capturedAt: Math.round(serverClock.now()),
    });
  }

  requestControl() {
    const { mode, hostId } = usePlayer.getState();
    if (mode !== "listener" || !hostId) {
      toast.error("Listen along first, then ask for control.");
      return;
    }
    if (!this.deps.send({ type: "control_request", roomId: hostId })) {
      toast.error("Reconnecting… try again in a moment.");
    }
  }

  releaseControl() {
    const hostId = this.controllingHost();
    if (!hostId) return;
    this.deps.send({ type: "control_release", roomId: hostId });
  }

  respondControl(userId: string, accept: boolean) {
    this.deps.send({ type: "control_respond", userId, accept });
  }

  revokeControl(userId: string) {
    this.deps.send({ type: "control_revoke", userId });
  }

  private publish() {
    const { mode } = usePlayer.getState();
    if (this.publishLocks > 0 || mode !== "host" || !this.loadedTrackId) return;
    this.deps.send({
      type: "state",
      trackId: this.loadedTrackId,
      positionMs: Math.round(this.audio.currentTime * 1000),
      paused: this.audio.paused,
      rate: this.audio.playbackRate,
      capturedAt: Math.round(serverClock.now()),
    });
  }

  // ---- Listener -----------------------------------------------------------

  listenAlong(hostId: string, hostName: string) {
    const { mode, hostId: current } = usePlayer.getState();
    if (mode === "listener" && current === hostId) return;
    if (mode === "host") this.deps.send({ type: "stop" });
    this.syncToken++;
    this.stopTimers();
    this.unload();
    this.userPaused = false;
    setPlayer({
      ...initialPlayerState,
      mode: "listener",
      status: "loading",
      hostId,
      hostName,
      notice: `Joining ${hostName}…`,
    });
    if (!this.deps.send({ type: "listen", roomId: hostId })) {
      setPlayer({ notice: "Reconnecting… you'll join as soon as we're back online." });
    }
    this.driftTimer = setInterval(this.driftTick, DRIFT_TICK_MS);
    void this.syncToRoom();
  }

  /** User gesture after autoplay was blocked or a local pause. */
  resync() {
    if (usePlayer.getState().mode !== "listener") return;
    this.userPaused = false;
    void this.syncToRoom();
  }

  /** Called whenever the realtime store changes. */
  onRoomChange(roomId: string) {
    const { mode, hostId } = usePlayer.getState();
    if (mode === "listener" && roomId === hostId) void this.syncToRoom();
    if (mode === "host" && roomId === this.deps.meId) void this.adoptRemote();
  }

  /** Apply a state published by someone who was granted control, without echoing it. */
  private async adoptRemote() {
    const token = ++this.remoteToken;
    const read = () => {
      const st = this.deps.getRoom(this.deps.meId)?.state;
      if (!st?.by || st.by === this.deps.meId) return null;
      return st;
    };
    if (!read()) return;
    this.publishLocks++;
    try {
      let st = read();
      if (!st) return;
      if (st.trackId !== this.loadedTrackId) {
        const track = await this.deps.fetchTrack(st.trackId);
        if (token !== this.remoteToken) return;
        st = read();
        if (!st || track.id !== st.trackId) return;
        await this.load(track);
        if (token !== this.remoteToken) return;
        st = read();
        if (!st) return;
      }
      this.audio.playbackRate = st.rate;
      const pos = st.paused ? st.positionMs : expectedPositionMs(st, serverClock.now());
      this.seekQuiet(pos);
      setPlayer({ positionMs: pos, notice: null });
      if (st.paused) {
        this.pauseQuiet();
        setPlayer({ status: "paused" });
      } else {
        this.userPaused = false;
        await this.playQuiet();
      }
    } catch (err) {
      if (err instanceof StaleLoad || token !== this.remoteToken) return;
      setPlayer({ status: "error", notice: errorMessage(err, "Couldn't follow the shared change.") });
    } finally {
      this.publishLocks = Math.max(0, this.publishLocks - 1);
    }
  }

  private async syncToRoom() {
    const { mode, hostId, hostName } = usePlayer.getState();
    if (mode !== "listener" || !hostId) return;
    const snap = this.deps.getRoom(hostId);
    if (!snap) return;
    const name = hostName ?? "The host";
    const st = snap.state;

    if (!st) {
      this.pauseQuiet();
      setPlayer({ status: "waiting", notice: `${name} isn't playing anything right now.` });
      return;
    }

    if (st.trackId !== this.loadedTrackId) {
      if (st.trackId === this.loadingTrackId) return;
      const token = ++this.syncToken;
      setPlayer({ status: "loading", notice: null });
      let track: Track;
      try {
        track = await this.deps.fetchTrack(st.trackId);
        if (token !== this.syncToken) return;
        await this.load(track);
      } catch (err) {
        if (err instanceof StaleLoad || token !== this.syncToken) return;
        this.loadingTrackId = null;
        setPlayer({ status: "error", notice: errorMessage(err, `Couldn't load what ${name} is playing.`) });
        return;
      }
      if (token !== this.syncToken) return;
    }

    const latest = this.deps.getRoom(hostId);
    if (latest?.state) this.applyRoomState(latest.state, latest.online, name);
  }

  private applyRoomState(st: RoomState, online: boolean, name: string) {
    if (st.paused || !online) {
      this.pauseQuiet();
      this.seekQuiet(st.positionMs);
      setPlayer({
        status: "waiting",
        notice: online ? `${name} paused.` : `${name} went offline. We'll pick up when they're back.`,
      });
      return;
    }
    const expected = expectedPositionMs(st, serverClock.now());
    const durationMs = Number.isFinite(this.audio.duration) ? this.audio.duration * 1000 : null;
    if (durationMs !== null && expected >= durationMs) {
      this.pauseQuiet();
      setPlayer({ status: "waiting", notice: `Waiting for ${name}'s next track.` });
      return;
    }
    if (Math.abs(this.audio.currentTime * 1000 - expected) > HARD_SEEK_MS) this.seekQuiet(expected);
    this.audio.playbackRate = st.rate;
    if (this.userPaused) {
      setPlayer({ status: "blocked", notice: "Paused on your side. Tap play to catch up." });
      return;
    }
    if (this.audio.paused) void this.playQuiet();
  }

  private driftTick = () => {
    const { mode, hostId } = usePlayer.getState();
    if (mode !== "listener" || !hostId) return;
    const st = this.deps.getRoom(hostId)?.state;
    if (!st || st.paused || this.audio.paused || this.audio.seeking || st.trackId !== this.loadedTrackId) return;

    const expected = expectedPositionMs(st, serverClock.now());
    const drift = this.audio.currentTime * 1000 - expected;
    const abs = Math.abs(drift);
    if (abs > HARD_SEEK_MS) {
      this.seekQuiet(expected);
      this.audio.playbackRate = st.rate;
    } else if (abs > NUDGE_MS) {
      const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift / 4000));
      this.audio.playbackRate = st.rate * (1 + nudge);
    } else if (this.audio.playbackRate !== st.rate) {
      this.audio.playbackRate = st.rate;
    }
    setPlayer({ driftMs: Math.round(drift) });
    if (++this.driftTicks % DRIFT_REPORT_EVERY === 0) this.deps.send({ type: "drift", driftMs: Math.round(drift) });
  };

  // ---- Socket hooks -------------------------------------------------------

  onSocketOpen() {
    const { mode, hostId } = usePlayer.getState();
    if (mode === "listener" && hostId) this.deps.send({ type: "listen", roomId: hostId });
    if (mode === "host") this.publish();
  }

  onServerError(msg: Extract<ServerMessage, { type: "error" }>): boolean {
    const { mode, hostId } = usePlayer.getState();
    switch (msg.code) {
      case "listen_forbidden":
      case "listen_invalid":
      case "listen_ended":
        if (mode === "listener" && (!msg.roomId || msg.roomId === hostId)) this.stop();
        toast.error(msg.message);
        return true;
      case "track_unavailable":
        if (mode === "host") this.stop();
        toast.error(msg.message);
        return true;
      case "not_controller":
      case "control_invalid":
      case "control_pending":
      case "control_expired":
        toast.error(msg.message);
        return true;
      default:
        return false;
    }
  }

  // ---- Volume -------------------------------------------------------------

  setVolume(v: number) {
    const volume = Math.min(1, Math.max(0, v));
    this.audio.volume = volume;
    this.audio.muted = volume === 0;
    if (volume > 0) localStorage.setItem(VOLUME_KEY, String(volume));
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
  }

  // ---- Media --------------------------------------------------------------

  private async load(track: Track): Promise<void> {
    this.unload();
    const token = ++this.loadToken;
    this.loadingTrackId = track.id;
    setPlayer({
      track,
      status: "loading",
      positionMs: 0,
      durationMs: track.durationMs ?? 0,
    });
    this.updateMediaSession(track);
    const url = track.manifestUrl;
    if (!url) throw new Error("This track has no stream.");

    const audio = this.audio;
    // Studio / visualizer needs MSE. Until then, Safari/iOS keep native HLS so
    // background playback and the Dynamic Island keep working.
    const wantNative = prefersNativeHls(audio) && !needsAudioGraph() && !this.graph.active;
    const { default: HlsCtor } = await import("hls.js");
    if (token !== this.loadToken) throw new StaleLoad();

    await new Promise<void>((resolve, reject) => {
      const useNative =
        wantNative || (!HlsCtor.isSupported() && Boolean(audio.canPlayType("application/vnd.apple.mpegurl")));
      if (!useNative && HlsCtor.isSupported()) {
        const hls = new HlsCtor({ maxBufferLength: 30, enableWorker: true });
        this.hls = hls;
        let parsed = false;
        let networkRetries = 0;
        let mediaRetries = 0;
        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          parsed = true;
          resolve();
        });
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal || this.hls !== hls) return;
          if (!parsed) {
            reject(new Error("Couldn't load this stream. Is storage running?"));
            return;
          }
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
            networkRetries++;
            setPlayer({ status: "buffering", notice: "Connection hiccup, retrying…" });
            setTimeout(() => this.hls === hls && hls.startLoad(), 1000 * networkRetries);
            return;
          }
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
            mediaRetries++;
            hls.recoverMediaError();
            return;
          }
          setPlayer({ status: "error", notice: "Playback stopped because the stream failed." });
        });
        hls.loadSource(url);
        hls.attachMedia(audio);
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        const onMeta = () => {
          audio.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = () => {
          audio.removeEventListener("loadedmetadata", onMeta);
          reject(new Error("Couldn't load this stream."));
        };
        audio.addEventListener("loadedmetadata", onMeta, { once: true });
        audio.addEventListener("error", onErr, { once: true });
        audio.src = url;
      } else {
        reject(new Error("Your browser can't play HLS audio."));
      }
    });

    if (token !== this.loadToken) throw new StaleLoad();
    this.loadedTrackId = track.id;
    this.loadingTrackId = null;
    await this.syncFx();
    setPlayer({ status: "paused" });
  }

  private unload() {
    this.loadToken++;
    this.pauseQuiet();
    this.hls?.destroy();
    this.hls = null;
    this.loadedTrackId = null;
    this.loadingTrackId = null;
    if (this.audio.getAttribute("src")) {
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.audio.playbackRate = 1;
  }

  private async playQuiet() {
    if (!this.audio.paused) return;
    this.expectPlay++;
    try {
      await this.graph.resume();
      await this.audio.play();
    } catch (err) {
      this.expectPlay = Math.max(0, this.expectPlay - 1);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPlayer({ status: "blocked", notice: "Your browser blocked autoplay. Tap play to start." });
      } else if (!(err instanceof DOMException && err.name === "AbortError")) {
        setPlayer({ status: "error", notice: "Playback couldn't start." });
      }
    }
  }

  private pauseQuiet() {
    if (this.audio.paused) return;
    this.expectPause++;
    this.audio.pause();
  }

  private seekQuiet(ms: number) {
    if (!this.loadedTrackId) return;
    this.audio.currentTime = Math.max(0, ms / 1000);
  }

  private onPlay = () => {
    const engineInitiated = this.expectPlay > 0;
    this.expectPlay = Math.max(0, this.expectPlay - 1);
    const { mode } = usePlayer.getState();
    if (mode === "host") {
      this.publish();
      return;
    }
    if (mode === "listener" && !engineInitiated && this.userPaused) {
      this.resync();
    }
  };

  private onPause = () => {
    const engineInitiated = this.expectPause > 0;
    this.expectPause = Math.max(0, this.expectPause - 1);
    const { mode } = usePlayer.getState();
    if (mode === "host") {
      this.publish();
      if (!this.audio.ended) setPlayer({ status: "paused" });
      return;
    }
    if (mode === "listener" && !engineInitiated) {
      this.userPaused = true;
      setPlayer({ status: "blocked", notice: "Paused on your side. Tap play to catch up." });
    }
  };

  private onEnded = () => {
    if (usePlayer.getState().mode === "host") {
      this.publish();
      setPlayer({ status: "paused" });
    }
  };

  private onTimeUpdate = () => {
    const now = performance.now();
    if (now - this.lastTimeUpdate < 250) return;
    this.lastTimeUpdate = now;
    setPlayer({ positionMs: this.audio.currentTime * 1000 });
    this.updatePositionState();
  };

  private stopTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.driftTimer) clearInterval(this.driftTimer);
    this.heartbeat = null;
    this.driftTimer = null;
    this.driftTicks = 0;
  }

  private on<K extends keyof HTMLMediaElementEventMap>(event: K, fn: (e: HTMLMediaElementEventMap[K]) => void) {
    this.audio.addEventListener(event, fn);
    this.cleanup.push(() => this.audio.removeEventListener(event, fn));
  }

  private setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void this.toggle()],
      ["pause", () => void this.toggle()],
      ["stop", () => this.stop()],
      [
        "seekto",
        (d) => {
          if (d.seekTime == null) return;
          this.seek(d.seekTime * 1000);
        },
      ],
      ["seekforward", (d) => this.seek((this.audio.currentTime + (d.seekOffset ?? 10)) * 1000)],
      ["seekbackward", (d) => this.seek((this.audio.currentTime - (d.seekOffset ?? 10)) * 1000)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Unsupported action on this browser.
      }
    }
    this.cleanup.push(() => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {}
      }
    });
  }

  private updateMediaSession(track: Track) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const art = track.coverUrl ? [{ src: track.coverUrl, sizes: "600x600", type: "image/jpeg" }] : undefined;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || `@${track.uploaderUsername}`,
      album: track.album || "Cadence",
      artwork: art,
    });
    this.updatePositionState();
  }

  private updatePositionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(this.audio.currentTime, duration),
      });
      navigator.mediaSession.playbackState = this.audio.paused ? "paused" : "playing";
    } catch {
      // Some browsers reject out-of-range position updates mid-seek.
    }
  }
}
