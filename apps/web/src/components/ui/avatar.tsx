import { initials, userHue } from "@/lib/artwork";
import { cn } from "@/lib/utils";

type Props = {
  userId: string;
  username: string;
  size?: "sm" | "md" | "lg";
  live?: boolean;
  className?: string;
};

const sizes = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-11 text-sm" };

export function Avatar({ userId, username, size = "md", live, className }: Props) {
  const hue = userHue(userId);
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn("inline-flex items-center justify-center rounded-full font-semibold text-white", sizes[size])}
        style={{ background: `linear-gradient(135deg, oklch(0.62 0.14 ${hue}), oklch(0.45 0.12 ${(hue + 40) % 360}))` }}
      >
        {initials(username)}
      </span>
      {live && (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-live ring-2 ring-background" />
      )}
    </span>
  );
}
