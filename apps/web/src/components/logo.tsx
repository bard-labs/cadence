import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle cx="12" cy="12" r="11" className="fill-foreground" />
        <path
          d="M7 13.5v-3M10 16v-8M14 14.5v-5M17 12.5v-1"
          className="stroke-background"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Cadence</span>
    </span>
  );
}
