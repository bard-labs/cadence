"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileAudio, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { type DragEvent, type FormEvent, useEffect, useId, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/ui/state";
import { api, errorMessage, queryKeys } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { ACCEPTED_AUDIO, audioContentType, titleFromFilename, uploadToStorage } from "@/lib/upload";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024;

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "registering" }
  | { kind: "done"; title: string }
  | { kind: "error"; message: string };

export function UploadView() {
  const queryClient = useQueryClient();
  const inputId = useId();
  const titleId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = phase.kind === "uploading" || phase.kind === "registering";

  const pick = (f: File | undefined) => {
    if (!f || busy) return;
    if (!audioContentType(f)) {
      setPhase({ kind: "error", message: "That doesn't look like an audio file. Try MP3, WAV, FLAC, OGG or M4A." });
      return;
    }
    if (f.size > MAX_BYTES) {
      setPhase({
        kind: "error",
        message: `That file is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_BYTES)}.`,
      });
      return;
    }
    if (f.size === 0) {
      setPhase({ kind: "error", message: "That file is empty." });
      return;
    }
    setFile(f);
    setTitle(titleFromFilename(f.name));
    setPhase({ kind: "idle" });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const reset = () => {
    abortRef.current?.abort();
    setFile(null);
    setTitle("");
    setPhase({ kind: "idle" });
    if (fileInput.current) fileInput.current.value = "";
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setPhase({ kind: "error", message: "Give your track a title." });
      return;
    }
    const contentType = audioContentType(file);
    if (!contentType) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "uploading", progress: 0 });
    try {
      const target = await api.createUpload();
      if (file.size > target.maxBytes) {
        throw new Error(`That file is larger than the ${formatBytes(target.maxBytes)} limit.`);
      }
      await uploadToStorage(target, file, contentType, {
        signal: controller.signal,
        onProgress: (progress) => setPhase({ kind: "uploading", progress }),
      });
      setPhase({ kind: "registering" });
      await api.createTrack(cleanTitle, target.objectKey);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tracks });
      setPhase({ kind: "done", title: cleanTitle });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "error",
        message: err instanceof Error && !("status" in err) ? err.message : errorMessage(err),
      });
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Upload" description="Audio up to 50 MB. We convert it to a stream your friends can sync to." />

      {phase.kind === "done" && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-live/25 bg-live/5 p-4 sm:flex-row sm:items-center"
        >
          <CheckCircle2 className="size-5 shrink-0 text-live" aria-hidden />
          <p className="flex-1 text-sm">
            <span className="font-medium">“{phase.title}”</span> is uploaded and processing. It'll be ready in a few
            seconds.
          </p>
          <Link href="/library" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 px-3")}>
            Go to library
          </Link>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        {!file ? (
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center transition-colors focus-within:ring-3 focus-within:ring-ring/40",
              dragging ? "border-foreground/40 bg-white/[0.04]" : "border-border hover:bg-white/[0.02]",
            )}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <UploadCloud className="size-5 text-muted-foreground" aria-hidden />
            </span>
            <span className="space-y-1">
              <span className="block text-sm font-medium">Drop an audio file, or click to choose</span>
              <span className="block text-xs text-muted-foreground">MP3, WAV, FLAC, OGG, M4A · up to 50 MB</span>
            </span>
            <input
              ref={fileInput}
              id={inputId}
              type="file"
              accept={ACCEPTED_AUDIO}
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="space-y-5 rounded-2xl border border-border p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <FileAudio className="size-5 text-muted-foreground" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              {!busy && (
                <Button type="button" variant="ghost" size="icon" onClick={reset} aria-label="Remove file">
                  <X />
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor={titleId} className="text-sm font-medium">
                Title
              </label>
              <Input
                id={titleId}
                value={title}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Track title"
              />
            </div>

            {phase.kind === "uploading" && (
              <div className="space-y-1.5" aria-live="polite">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-foreground transition-[width] duration-200"
                    style={{ width: `${Math.round(phase.progress * 100)}%` }}
                  />
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  Uploading… {Math.round(phase.progress * 100)}%
                </p>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {phase.kind === "uploading" && (
                <Button type="button" variant="outline" className="h-9 px-4" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </Button>
              )}
              <Button type="submit" className="h-9 px-4" disabled={busy || !title.trim()}>
                {busy && <Spinner className="text-primary-foreground" label="Uploading" />}
                {phase.kind === "registering" ? "Finishing…" : phase.kind === "uploading" ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        )}

        {phase.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {phase.message}
          </p>
        )}
      </form>
    </div>
  );
}
