"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinListenAlong } from "@/features/player/audio-player";
import { cadenceApi } from "@/lib/api";

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const me = useQuery({ queryKey: ["me"], queryFn: () => cadenceApi.me() });
  const group = useQuery({
    queryKey: ["group", params.id],
    queryFn: () => cadenceApi.getGroup(params.id),
    refetchInterval: 4000,
  });
  const [inviteUser, setInviteUser] = useState("");

  return (
    <AppShell username={me.data?.username}>
      <h1 className="text-2xl font-semibold mb-6">Group</h1>
      <div className="flex gap-2 mb-8 max-w-md">
        <Input placeholder="Invite by username" value={inviteUser} onChange={(e) => setInviteUser(e.target.value)} />
        <Button
          type="button"
          onClick={() => cadenceApi.invite(params.id, inviteUser.trim()).then(() => setInviteUser(""))}
        >
          Invite
        </Button>
      </div>
      <h2 className="text-sm uppercase tracking-widest text-zinc-500 mb-3">Now listening</h2>
      <ul className="space-y-3">
        {(group.data?.listening ?? []).map((s) => (
          <li key={s.userId} className="flex items-center justify-between rounded-xl border border-white/5 px-4 py-3">
            <div>
              <p className="font-medium">@{s.username}</p>
              <p className="text-sm text-zinc-500">
                {s.trackTitle ? `${s.trackTitle} · ${s.paused ? "paused" : "playing"}` : "Idle"}
              </p>
            </div>
            {s.userId !== me.data?.id && s.trackId && !s.paused ? (
              <Button type="button" size="sm" onClick={() => joinListenAlong(s.userId)}>Listen along</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
