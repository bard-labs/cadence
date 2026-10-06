"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cadenceApi } from "@/lib/api";

export default function GroupsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => cadenceApi.me() });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => cadenceApi.listGroups() });
  const invites = useQuery({ queryKey: ["invites"], queryFn: () => cadenceApi.pendingInvites() });
  const [name, setName] = useState("");

  async function createGroup() {
    await cadenceApi.createGroup(name.trim());
    setName("");
    await qc.invalidateQueries({ queryKey: ["groups"] });
  }

  return (
    <AppShell username={me.data?.username}>
      <h1 className="text-2xl font-semibold mb-6">Groups</h1>
      <div className="flex gap-2 mb-8 max-w-md">
        <Input placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="button" onClick={createGroup} disabled={!name.trim()}>Create</Button>
      </div>
      {invites.data?.length ? (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-widest text-zinc-500 mb-3">Invites</h2>
          <ul className="space-y-2">
            {invites.data.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between rounded-lg border border-white/5 px-4 py-3">
                <span>{inv.groupName} from @{inv.inviterUsername}</span>
                <Button
                  type="button"
                  size="sm"
                  onClick={async () => {
                    await cadenceApi.acceptInvite(inv.id);
                    await qc.invalidateQueries({ queryKey: ["invites", "groups"] });
                  }}
                >
                  Accept
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul className="space-y-2">
        {(groups.data ?? []).map((g) => (
          <li key={g.id}>
            <Link href={`/groups/${g.id}`} className="block rounded-lg border border-white/5 px-4 py-3 hover:bg-white/5">
              {g.name}
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
