const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

export type PlaybackState = {
  hostUserId: string;
  trackId: string;
  positionMs: number;
  serverTs: number;
  paused: boolean;
  rate: number;
  seq: number;
};

type MessageHandler = (data: unknown) => void;

export class CadenceSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private clockOffsetMs = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.ws = new WebSocket(WS_URL);
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        if (data.type === "pong" && typeof data.t0 === "number" && typeof data.ts === "number") {
          const t1 = Date.now();
          const rtt = t1 - data.t0;
          const offset = data.ts + rtt / 2 - t1;
          this.clockOffsetMs = offset;
        }
        for (const h of this.handlers) h(data);
      } catch {
        /* ignore */
      }
    };
    this.pingTimer = setInterval(() => this.ping(), 30_000);
    this.ping();
  }

  disconnect() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  serverNow() {
    return Date.now() + this.clockOffsetMs;
  }

  joinRoom(hostUserId: string) {
    this.send({ type: "join", hostUserId });
  }

  publishState(state: Omit<PlaybackState, "hostUserId" | "serverTs"> & { hostUserId: string }) {
    this.send({
      type: "state",
      trackId: state.trackId,
      positionMs: state.positionMs,
      paused: state.paused,
      rate: state.rate,
      seq: state.seq,
    });
  }

  reportDrift(driftMs: number) {
    this.send({ type: "drift", driftMs });
  }

  private ping() {
    this.send({ type: "ping", t0: Date.now() });
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

export const DRIFT = {
  ignoreMs: 40,
  nudgeMaxMs: 400,
  nudgeRateMin: 0.97,
  nudgeRateMax: 1.03,
};

export function correctDrift(
  audio: HTMLAudioElement,
  expectedMs: number,
  currentMs: number,
  socket: CadenceSocket,
) {
  const drift = expectedMs - currentMs;
  if (Math.abs(drift) <= DRIFT.ignoreMs) return;
  if (Math.abs(drift) > DRIFT.nudgeMaxMs) {
    audio.currentTime = expectedMs / 1000;
    audio.playbackRate = 1;
    return;
  }
  const factor = drift > 0 ? DRIFT.nudgeRateMax : DRIFT.nudgeRateMin;
  audio.playbackRate = factor;
  socket.reportDrift(drift);
}
