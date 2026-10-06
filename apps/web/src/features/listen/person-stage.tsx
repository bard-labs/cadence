"use client";

import type { RoomSnapshot } from "@bardlabs/cadence-protocol";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Library, LogOut, Radio, SlidersHorizontal, Upload, X } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { SeekBar } from "@/components/ui/seek-bar";
import { Vinyl } from "@/features/listen/vinyl";
import { useFriends, useLive } from "@/features/live/live-provider";
import { useLivePosition } from "@/features/live/use-live-position";
import { usePlayer } from "@/features/player/player-store";
import { api, type Friend, queryKeys } from "@/lib/api";
import { userHue } from "@/lib/artwork";
import { formatRelative } from "@/lib/format";
import { useRoom } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

type Person = { id: string; username: string; isMe: boolean; friend?: Friend };

export function PersonStage({ person }: { person: Person }) {
  const { engine, me } = useLive();
  const friends = useFriends();
  const player = usePlayer();
  const ownRoom = useRoom(person.id);

  // On your own tab, show what you're hearing, even when it's someone else's room.
  const followingId = person.isMe && player.mode === "listener" ? player.hostId : null;
  const followedRoom = useRoom(followingId);
  const room: RoomSnapshot | undefined = followingId ? followedRoom : ownRoom;
  const state = room?.state ?? null;

  const track = useQuery({
    queryKey: queryKeys.track(state?.trackId ?? ""),
    queryFn: ({ signal }) => api.track(state?.trackId ?? "", signal),
    enabled: Boolean(state?.trackId),
    staleTime: 60_000,
  });
  const position = useLivePosition(state);

  const online = person.isMe || Boolean(room?.online);
  const playing = Boolean(state && !state.paused && (followingId ? followedRoom?.online : online));
  const listeningHere = !person.isMe && player.mode === "listener" && player.hostId === person.id;
  const controllers = room?.controllers ?? [];
  const myControllers = ownRoom?.controllers ?? [];
  const iControl = listeningHere && controllers.includes(me.id);
  const names = new Map((friends.data ?? []).map((f) => [f.userId, f.username]));
  const durationMs = track.data?.durationMs ?? 0;

  return (
    <div className="flex flex-col items-center gap-8 md:flex-row md:items-center md:justify-center md:gap-14">
      <Vinyl
        trackId={state?.trackId ?? null}
        coverUrl={track.data?.coverUrl}
        hue={userHue(person.id)}
        spinning={playing}
      />

      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center md:items-start md:text-left">
        <StatusChip
          person={person}
          online={online}
          playing={playing}
          hasState={Boolean(state)}
          followingName={followingId ? player.hostName : null}
        />

        <div className="w-full space-y-1.5">
          <h2 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
            {state ? (track.data?.title ?? (track.isError ? "Unknown track" : "Loading…")) : "Nothing playing"}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {state && track.data ? trackCredit(track.data) : emptyLine(person, online)}
          </p>
        </div>

        {state && durationMs > 0 && (
          <SeekBar positionMs={Math.min(position, durationMs)} durationMs={durationMs} className="max-w-sm" />
        )}

        {room && room.listeners > 0 && !followingId && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Headphones className="size-4" aria-hidden />
            {room.listeners === 1 ? "1 person listening along" : `${room.listeners} people listening along`}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
          {person.isMe ? (
            <>
              <Link href="/library" className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}>
                <Library data-icon="inline-start" />
                {player.mode === "host" ? "Pick another track" : "Play something"}
              </Link>
              <Link href="/upload" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 px-4")}>
                <Upload data-icon="inline-start" />
                Upload
              </Link>
            </>
          ) : listeningHere ? (
            <>
              {iControl ? (
                <Button variant="outline" size="lg" className="h-10 px-4" onClick={() => engine?.releaseControl()}>
                  <SlidersHorizontal data-icon="inline-start" />
                  Release control
                </Button>
              ) : (
                <Button size="lg" className="h-10 px-4" onClick={() => engine?.requestControl()}>
                  <SlidersHorizontal data-icon="inline-start" />
                  Take control
                </Button>
              )}
              <Button variant="outline" size="lg" className="h-10 px-4" onClick={() => engine?.stop()}>
                <LogOut data-icon="inline-start" />
                Stop listening
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              className="h-10 px-4"
              disabled={!online || !state || !engine}
              onClick={() => engine?.listenAlong(person.id, person.username)}
            >
              <Radio data-icon="inline-start" />
              Listen along
            </Button>
          )}
        </div>

        {person.isMe && myControllers.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {myControllers.map((id) => (
              <li key={id} className="flex items-center gap-2">
                <span className="truncate">@{names.get(id) ?? "friend"} has control</span>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => engine?.revokeControl(id)}>
                  <X data-icon="inline-start" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        {person.friend && person.friend.groups.length > 0 && (
          <p className="text-xs text-muted-foreground">
            In {person.friend.groups.slice(0, 3).join(", ")}
            {person.friend.groups.length > 3 && ` +${person.friend.groups.length - 3}`}
          </p>
        )}
      </div>
    </div>
  );
}

function trackCredit(track: {
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  uploaderUsername: string;
}): string {
  const bits = [track.artist, track.album, track.year].filter(Boolean);
  if (bits.length > 0) return bits.join(" · ");
  return `Uploaded by @${track.uploaderUsername}`;
}

function emptyLine(person: Person, online: boolean): string {
  if (person.isMe) return "Play a track and your friends can listen along.";
  const f = person.friend;
  if (!online) {
    return f?.lastTrackTitle
      ? `Offline · last played “${f.lastTrackTitle}” ${formatRelative(f.lastPlayedAt)}`
      : "Offline";
  }
  return `@${person.username} is online but not playing anything.`;
}

function StatusChip({
  person,
  online,
  playing,
  hasState,
  followingName,
}: {
  person: Person;
  online: boolean;
  playing: boolean;
  hasState: boolean;
  followingName: string | null;
}) {
  let label: string;
  let tone: "live" | "idle" | "off";
  if (followingName) {
    label = `Listening along with @${followingName}`;
    tone = playing ? "live" : "idle";
  } else if (playing) {
    label = person.isMe ? "You're live" : "Live now";
    tone = "live";
  } else if (hasState && online) {
    label = "Paused";
    tone = "idle";
  } else if (online) {
    label = person.isMe ? "You" : "Online";
    tone = "idle";
  } else {
    label = "Offline";
    tone = "off";
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "live" && "bg-live shadow-[0_0_8px] shadow-live",
          tone === "idle" && "bg-muted-foreground",
          tone === "off" && "bg-muted-foreground/40",
        )}
      />
      {label}
    </span>
  );
}
