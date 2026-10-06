"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Headphones, Library, LogOut, Upload, Users, WifiOff } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState } from "@/components/ui/state";
import { LiveProvider } from "@/features/live/live-provider";
import { PlayerBar } from "@/features/player/player-bar";
import { usePlayer } from "@/features/player/player-store";
import { ApiError, api, queryKeys, type User } from "@/lib/api";
import { useRealtime } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Listen", icon: Headphones },
  { href: "/library", label: "Library", icon: Library },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/groups", label: "Groups", icon: Users },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api.me(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (me.isPending || (me.isError && me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5">
        <ErrorState error={me.error} onRetry={() => me.refetch()} className="w-full max-w-md" />
      </div>
    );
  }

  return (
    <LiveProvider me={me.data}>
      <Shell me={me.data}>{children}</Shell>
    </LiveProvider>
  );
}

function Shell({ me, children }: { me: User; children: ReactNode }) {
  const pathname = usePathname();
  const hasPlayer = usePlayer((s) => s.mode !== "idle");
  const invites = useQuery({
    queryKey: queryKeys.invites,
    queryFn: ({ signal }) => api.invites(signal),
    refetchInterval: 20_000,
  });
  const inviteCount = invites.data?.length ?? 0;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-background/55 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex h-8 items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            aria-label="Cadence home"
          >
            <Logo />
          </Link>
          <nav aria-label="Main" className="ml-1 hidden h-8 items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-3 text-sm leading-none text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
                  isActive(item.href) && "text-foreground",
                )}
              >
                {item.label}
                {item.href === "/groups" && inviteCount > 0 && <Badge count={inviteCount} />}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex h-8 items-center gap-2">
            <ConnectionPill />
            <UserMenu me={me} />
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-6xl flex-1 px-4 pt-6 sm:px-6 sm:pt-10",
          hasPlayer ? "pb-48 sm:pb-28" : "pb-24 sm:pb-12",
        )}
      >
        {children}
      </main>

      <PlayerBar />

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
      >
        <div className="grid h-14 grid-cols-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground outline-none focus-visible:bg-muted",
                isActive(item.href) && "text-foreground",
              )}
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
              {item.href === "/groups" && inviteCount > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 size-2 rounded-full bg-live">
                  <span className="sr-only">{inviteCount} pending invites</span>
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-live px-1 text-[10px] font-semibold text-black">
      <span className="sr-only">, </span>
      {count > 9 ? "9+" : count}
      <span className="sr-only"> pending invites</span>
    </span>
  );
}

function ConnectionPill() {
  const status = useRealtime((s) => s.status);
  if (status === "open" || status === "connecting") return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
    >
      {status === "offline" ? <WifiOff className="size-3.5" aria-hidden /> : <Spinner className="size-3.5" label="" />}
      {status === "offline" ? "Offline" : "Reconnecting"}
    </span>
  );
}

function UserMenu({ me }: { me: User }) {
  const logout = useMutation({
    mutationFn: api.logout,
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reset of the old session
    onSuccess: () => window.location.assign("/login"),
  });
  return (
    <div className="flex h-8 items-center gap-1">
      <span className="hidden h-8 items-center gap-2 rounded-full pr-2 pl-1 text-sm md:inline-flex">
        <Avatar userId={me.id} username={me.username} size="sm" />
        <span className="max-w-32 truncate leading-none text-muted-foreground">@{me.username}</span>
      </span>
      <span className="inline-flex h-8 items-center md:hidden">
        <Avatar userId={me.id} username={me.username} size="sm" />
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        aria-label="Sign out"
        title="Sign out"
      >
        {logout.isPending ? <Spinner /> : <LogOut />}
      </Button>
    </div>
  );
}
