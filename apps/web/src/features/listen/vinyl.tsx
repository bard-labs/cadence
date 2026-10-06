import { Disc3 } from "lucide-react";
import Image from "next/image";

import { coverUrl } from "@/lib/artwork";
import { cn } from "@/lib/utils";

/** Circular artwork that spins while playing and holds its angle when paused. */
export function Vinyl({
  trackId,
  coverUrl: embedded,
  hue,
  spinning,
}: {
  trackId: string | null;
  coverUrl?: string | null;
  hue: number;
  spinning: boolean;
}) {
  const src = embedded || (trackId ? coverUrl(trackId) : null);
  return (
    <div className="relative isolate size-56 shrink-0 sm:size-72">
      <div
        aria-hidden
        className="absolute -inset-20 -z-10"
        style={{
          background: `
            radial-gradient(closest-side, oklch(0.55 0.22 320 / 0.4), transparent 70%),
            radial-gradient(closest-side, oklch(0.5 0.16 ${hue} / 0.28), transparent 72%),
            radial-gradient(circle at 50% 80%, oklch(0.6 0.12 220 / 0.22), transparent 55%)
          `,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-[-6%] -z-10 rounded-full opacity-70"
        style={{
          background: `conic-gradient(from 200deg, oklch(0.55 0.22 320 / 0.0), oklch(0.6 0.2 320 / 0.45), oklch(0.7 0.12 220 / 0.35), oklch(0.5 0.18 290 / 0.4), oklch(0.55 0.22 320 / 0.0))`,
          filter: "blur(14px)",
        }}
      />
      <div
        className={cn(
          "relative size-full overflow-hidden rounded-full border border-white/12 bg-muted shadow-2xl shadow-black/60",
          "animate-[spin_24s_linear_infinite] motion-reduce:animate-none",
        )}
        style={{ animationPlayState: spinning ? "running" : "paused" }}
      >
        {src ? (
          src.startsWith("https://images.unsplash.com/") ? (
            <Image src={src} alt="" fill sizes="(min-width: 640px) 288px, 224px" className="object-cover" priority />
          ) : (
            // The file's own cover is served from object storage, which is not a Next image host.
            // biome-ignore lint/performance/noImgElement: remote cover URL is dynamic per upload
            <img src={src} alt="" className="size-full object-cover" />
          )
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
