type Sample = { offsetMs: number; rttMs: number };

/**
 * NTP-style offset estimate. Each ping/pong gives offset = serverTs - (localNow - rtt/2).
 * The sample with the smallest RTT is the least distorted by queuing, so we keep
 * the last few and trust the fastest one.
 */
export class ServerClock {
  private samples: Sample[] = [];
  private best: Sample | null = null;

  constructor(private readonly window = 8) {}

  addSample(t0: number, serverTs: number) {
    const rttMs = performance.now() - t0;
    if (rttMs < 0 || rttMs > 10_000) return;
    const offsetMs = serverTs - (Date.now() - rttMs / 2);
    this.samples.push({ offsetMs, rttMs });
    if (this.samples.length > this.window) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
  }

  get synced() {
    return this.best !== null;
  }

  get offsetMs() {
    return this.best?.offsetMs ?? 0;
  }

  get rttMs() {
    return this.best?.rttMs ?? null;
  }

  now() {
    return Date.now() + this.offsetMs;
  }
}

export const serverClock = new ServerClock();
