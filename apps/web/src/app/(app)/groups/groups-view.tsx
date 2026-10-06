"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Crown, Mail, Plus, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/state";
import { api, type Invite, queryKeys } from "@/lib/api";
import { formatRelative } from "@/lib/format";

export function GroupsView() {
  const groups = useQuery({ queryKey: queryKeys.groups, queryFn: ({ signal }) => api.groups(signal) });
  const invites = useQuery({
    queryKey: queryKeys.invites,
    queryFn: ({ signal }) => api.invites(signal),
    refetchInterval: 20_000,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader title="Groups" description="Everyone in your groups shows up as a tab on the Listen page." />

      {invites.data && invites.data.length > 0 && (
        <section aria-labelledby="invites-heading" className="space-y-3">
          <h2 id="invites-heading" className="text-sm font-medium text-muted-foreground">
            Invites
          </h2>
          <ul className="space-y-2">
            {invites.data.map((inv) => (
              <InviteRow key={inv.id} invite={inv} />
            ))}
          </ul>
        </section>
      )}

      <CreateGroup />

      <section aria-labelledby="groups-heading" className="space-y-3">
        <h2 id="groups-heading" className="text-sm font-medium text-muted-foreground">
          Your groups
        </h2>
        {groups.isPending ? (
          <PageSpinner />
        ) : groups.isError ? (
          <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
        ) : groups.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No groups yet"
            description="Create one above, then invite friends by username."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {groups.data.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
                    {g.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {g.name}
                      {g.role === "owner" && <Crown className="size-3.5 text-muted-foreground" aria-label="Owner" />}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {g.memberCount === 1 ? "Just you" : `${g.memberCount} members`}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateGroup() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.createGroup(name.trim()),
    onSuccess: async (g) => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      toast.success(`Created ${g.name}. Invite some friends.`);
      router.push(`/groups/${g.id}`);
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    create.mutate();
  };
  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="New group name, e.g. Night Drive"
        aria-label="New group name"
      />
      <Button type="submit" className="h-10 shrink-0 px-4" disabled={!name.trim() || create.isPending}>
        {create.isPending ? <Spinner className="text-primary-foreground" /> : <Plus data-icon="inline-start" />}
        Create
      </Button>
    </form>
  );
}

function InviteRow({ invite }: { invite: Invite }) {
  const queryClient = useQueryClient();
  const respond = useMutation({
    mutationFn: (accept: boolean) => (accept ? api.acceptInvite(invite.id) : api.declineInvite(invite.id)),
    onSuccess: (_d, accept) => {
      if (accept) toast.success(`You joined ${invite.groupName}.`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites });
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
  });
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-4 sm:flex-row sm:items-center">
      <Mail className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
      <p className="flex-1 text-sm">
        <span className="font-medium">@{invite.inviterUsername}</span> invited you to{" "}
        <span className="font-medium">{invite.groupName}</span>
        <span className="text-muted-foreground"> · {formatRelative(invite.createdAt)}</span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3"
          disabled={respond.isPending}
          onClick={() => respond.mutate(false)}
        >
          <X data-icon="inline-start" />
          Decline
        </Button>
        <Button size="sm" className="h-8 px-3" disabled={respond.isPending} onClick={() => respond.mutate(true)}>
          {respond.isPending ? <Spinner className="text-primary-foreground" /> : <Check data-icon="inline-start" />}
          Join
        </Button>
      </div>
    </li>
  );
}
