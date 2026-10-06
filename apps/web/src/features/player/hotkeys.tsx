"use client";

import { useEffect } from "react";

import { useLive } from "@/features/live/live-provider";
import { usePlayer } from "@/features/player/player-store";

/** Space pauses / resumes when the player is active and focus isn't in a field. */
export function PlayerHotkeys() {
  const { engine } = useLive();
  const mode = usePlayer((s) => s.mode);

  useEffect(() => {
    if (mode === "idle" || !engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      e.preventDefault();
      void engine.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, mode]);

  return null;
}
