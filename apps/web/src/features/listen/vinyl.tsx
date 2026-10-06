import { Disc3 } from "lucide-react";
import Image from "next/image";

import { coverUrl } from "@/lib/artwork";
import { cn } from "@/lib/utils";

/** Circular artwork that spins while playing and holds its angle when paused. */
export function Vinyl({ trackId, hue, spinning }: { trackId: string | null; hue: number; spinning: boolean }) {
  return (
    <div className="relative isolate size-56 shrink-0 sm:size-72">
      <div
        aria-hidden
        className="absolute -inset-16 -z-10"
        style={{ background: `radial-gradient(closest-side, oklch(0.55 0.14 ${hue} / 0.35), transparent)` }}
      />
      <div
        className={cn(
          "relative size-full overflow-hidden rounded-full border border-white/10 bg-muted shadow-2xl shadow-black/50",
          "animate-[spin_24s_linear_infinite] motion-reduce:animate-none",
        )}
        style={{ animationPlayState: spinning ? "running" : "paused" }}
      >
        {trackId ? (
          <Image
            src={coverUrl(trackId)}
            alt=""
            fill
            sizes="(min-width: 640px) 288px, 224px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-[radial-gradient(circle,oklch(0.26_0.01_286),oklch(0.18_0.005_286))]">
            <Disc3 className="size-14 text-muted-foreground/40" aria-hidden />
          </div>
        )}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full bg-[repeating-radial-gradient(circle,transparent_0,transparent_3px,rgb(0_0_0/0.06)_4px)]"
        />
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 size-12 -translate-1/2 rounded-full border border-white/10 bg-background sm:size-14"
        />
        <div aria-hidden className="absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-white/20" />
      </div>
    </div>
  );
}
