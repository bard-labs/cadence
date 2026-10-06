"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Music, Pause, Play, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/state";
import { useLive } from "@/features/live/live-provider";
import { usePlayer } from "@/features/player/player-store";
import { api, queryKeys, type Track } from "@/lib/api";
import { coverUrl } from "@/lib/artwork";
import { formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export function LibraryView() {
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(filter.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [filter]);

  const tracks = useQuery({
    queryKey: queryKeys.tracks(page, q),
    queryFn: ({ signal }) => api.tracks({ page, pageSize: PAGE_SIZE, q }, signal),
    placeholderData: (prev) => prev,
    refetchInterval: (query) => (query.state.data?.items.some((t) => t.status === "processing") ? 3000 : false),
  });

  const data = tracks.data;
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 0;
  const total = data?.total ?? 0;
  const emptyLibrary = !tracks.isPending && !tracks.isError && total === 0 && !q;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Library"
        description="Everything uploaded to Cadence. Play a track and your friends can join."
        action={
          <Link href="/upload" className={cn(buttonVariants(), "h-9 px-4")}>
            <Upload data-icon="inline-start" />
            Upload
          </Link>
        }
      />

      {tracks.isPending && !data ? (
        <PageSpinner />
      ) : tracks.isError ? (
        <ErrorState error={tracks.error} onRetry={() => tracks.refetch()} />
      ) : emptyLibrary ? (
        <EmptyState
          icon={Music}
          title="No tracks yet"
          description="Upload an audio file and it'll show up here once it's processed."
          action={
            <Link href="/upload" className={cn(buttonVariants({ variant: "outline" }), "h-9 px-4")}>
              Upload a track
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              type="search"
              placeholder="Search by title, artist, or uploader"
              aria-label="Search tracks"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <p className="text-xs text-muted-foreground">
              {total === 0 ? "No matches" : `${total} track${total === 1 ? "" : "s"}`}
              {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
            </p>
          </div>

          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tracks match “{q}”.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {items.map((t) => (
                <TrackRow key={t.id} track={t} />
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || tracks.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft data-icon="inline-start" />
                Prev
              </Button>
              <span className="min-w-24 text-center text-sm tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || tracks.isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrackRow({ track }: { track: Track }) {
  const { engine } = useLive();
  const current = usePlayer((s) => s.mode === "host" && s.track?.id === track.id);
  const playing = usePlayer((s) => s.status === "playing" || s.status === "buffering");
  const ready = track.status === "ready";

  const onPlay = () => {
    if (!engine) return;
    if (current) void engine.toggle();
    else void engine.playTrack(track);
  };

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 transition-colors sm:gap-4 sm:px-4",
        current && "bg-white/[0.04]",
      )}
    >
      <div className="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted">
        {track.coverUrl ? (
          // biome-ignore lint/performance/noImgElement: cover is served from object storage
          <img src={track.coverUrl} alt="" className={cn("size-full object-cover", !ready && "opacity-40 grayscale")} />
        ) : (
          <Image
            src={coverUrl(track.id, 120)}
            alt=""
            fill
            sizes="44px"
            className={cn("object-cover", !ready && "opacity-40 grayscale")}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", current && "text-live")}>{track.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {track.artist ? `${track.artist} · ` : ""}@{track.uploaderUsername} · {formatRelative(track.createdAt)}
        </p>
      </div>
      <StatusCell track={track} />
      <Button
        variant={current ? "default" : "ghost"}
        size="icon"
        className="rounded-full"
        disabled={!ready || !engine}
        onClick={onPlay}
        aria-label={current && playing ? `Pause ${track.title}` : `Play ${track.title}`}
      >
        {current && playing ? <Pause /> : <Play className="ml-0.5" />}
      </Button>
    </li>
  );
}

function StatusCell({ track }: { track: Track }) {
  if (track.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3.5" label="Processing" />
        <span className="hidden sm:inline">Processing</span>
      </span>
    );
  }
  if (track.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive" title={track.error ?? undefined}>
        <AlertTriangle className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Failed</span>
      </span>
    );
  }
  return (
    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{formatTime(track.durationMs)}</span>
  );
}
