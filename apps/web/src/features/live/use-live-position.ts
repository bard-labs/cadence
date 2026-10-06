import { expectedPositionMs, type RoomState } from "@bardlabs/cadence-protocol";
import { useEffect, useState } from "react";

import { serverClock } from "@/lib/realtime/clock";

/** Ticks while a room is playing so progress bars move without new snapshots. */
export function useLivePosition(state: RoomState | null | undefined, intervalMs = 500): number {
  const [now, setNow] = useState(() => serverClock.now());

  useEffect(() => {
    if (!state || state.paused) return;
    const id = setInterval(() => setNow(serverClock.now()), intervalMs);
    return () => clearInterval(id);
  }, [state, intervalMs]);

  if (!state) return 0;
  return expectedPositionMs(state, Math.max(now, state.capturedAt));
}
