import type { ClientMessage, ServerMessage } from "@bardlabs/cadence-protocol";

import { serverClock } from "@/lib/realtime/clock";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "offline";

type Handlers = {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
  onOpen: () => void;
  /** Called after repeated failures so the app can check whether the session expired. */
  onRepeatedFailure: () => void;
};

const PING_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One WebSocket per tab with reconnect (exponential backoff + jitter) and a
 * ping loop that doubles as clock sync and presence heartbeat.
 */
export class CadenceSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private burstTimers: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly handlers: Handlers,
  ) {}

  start() {
    this.stopped = false;
    window.addEventListener("online", this.onOnline);
    this.connect();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    this.clearTimers();
    this.ws?.close(1000, "bye");
    this.ws = null;
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private onOnline = () => {
    if (this.stopped || this.isOpen) return;
    this.attempts = 0;
    this.clearTimers();
    this.connect();
  };

  private connect() {
    this.handlers.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus("open");
      this.burstPing();
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
      this.handlers.onOpen();
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "pong") {
        serverClock.addSample(msg.t0, msg.ts);
        return;
      }
      this.handlers.onMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  /** A few quick pings right after connecting so playback can sync immediately. */
  private burstPing() {
    for (let i = 0; i < 4; i++) {
      this.burstTimers.push(setTimeout(() => this.ping(), i * 150));
    }
  }

  private ping() {
    this.send({ type: "ping", t0: performance.now() });
  }

  private scheduleReconnect() {
    this.attempts++;
    if (this.attempts === 3) this.handlers.onRepeatedFailure();
    const online = typeof navigator === "undefined" || navigator.onLine;
    this.handlers.onStatus(online ? "reconnecting" : "offline");
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempts, 6));
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const t of this.burstTimers) clearTimeout(t);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.burstTimers = [];
  }
}
