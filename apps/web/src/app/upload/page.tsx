"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cadenceApi } from "@/lib/api";

export default function UploadPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => cadenceApi.me() });
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStatus("Requesting upload URL…");
    const { objectKey, uploadUrl } = await cadenceApi.uploadUrl();
    setStatus("Uploading…");
    await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "audio/mpeg" } });
    setStatus("Registering track…");
    await cadenceApi.createTrack(title.trim() || file.name, objectKey);
    setStatus("Queued for transcoding. Check Library in a moment.");
    setTitle("");
    setFile(null);
  }

  return (
    <AppShell username={me.data?.username}>
      <h1 className="text-2xl font-semibold mb-6">Upload</h1>
      <form onSubmit={onUpload} className="max-w-md space-y-4">
        <Input placeholder="Track title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button type="submit" disabled={!file}>Upload</Button>
        {status ? <p className="text-sm text-zinc-400">{status}</p> : null}
      </form>
    </AppShell>
  );
}
