"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, SearchX, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { useLive } from "@/features/live/live-provider";
import { ApiError, api, errorMessage, type GroupDetail, type Member, queryKeys } from "@/lib/api";
import { formatRelative, normalizeUsername, usernameProblem } from "@/lib/format";
import { useRoom } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

export function GroupDetailView({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: queryKeys.group(id),
    queryFn: ({ signal }) => api.group(id, signal),
    refetchInterval: 20_000,
    retry: (n, err) => n < 2 && !(err instanceof ApiError && err.status < 500 && err.status !== 0),
  });

  const back = (
    <Link
      href="/groups"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Groups
    </Link>
  );

  if (detail.isPending) return <PageSpinner />;
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {back}
        {notFound ? (
          <EmptyState icon={SearchX} title="Group not found" description={errorMessage(detail.error)} />
        ) : (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        )}
      </div>
    );
  }

  const { group, members, invites } = detail.data;
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-4">
        {back}
        <div className="space-y-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {members.length === 1 ? "Just you so far" : `${members.length} members`}
            {group.role === "owner" && " · You own this group"}
          </p>
        </div>
      </div>

      <InviteForm groupId={group.id} />

      <section aria-labelledby="members-heading" className="space-y-3">
        <h2 id="members-heading" className="text-sm font-medium text-muted-foreground">
          Members
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} />
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section aria-labelledby="pending-heading" className="space-y-3">
          <h2 id="pending-heading" className="text-sm font-medium text-muted-foreground">
            Pending invites
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Clock className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate">@{inv.inviteeUsername}</span>
                <span className="text-xs text-muted-foreground">invited {formatRelative(inv.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DangerZone detail={detail.data} />
    </div>
  );
}

function inviteError(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_username") return "That isn't a valid username.";
  return errorMessage(err);
}

function InviteForm({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const username = normalizeUsername(raw);
  const problem = usernameProblem(username);

  const invite = useMutation({
    mutationFn: () => api.invite(groupId, username),
    meta: { silent: true },
    onSuccess: (res) => {
      setRaw("");
      toast.success(`Invited @${res.username}. They'll see it on their Groups page.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || problem || invite.isPending) return;
    invite.mutate();
  };

  const message = (raw && problem) || (invite.isError ? inviteError(invite.error) : null);

  return (
    <form onSubmit={onSubmit} className="space-y-2" noValidate>
      <label htmlFor="invite-username" className="text-sm font-medium">
        Invite by username
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
            @
          </span>
          <Input
            id="invite-username"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value.toLowerCase());
              if (invite.isError) invite.reset();
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={24}
            placeholder="friend_name"
            aria-invalid={Boolean(message)}
            aria-describedby="invite-error"
            className="pl-7"
          />
        </div>
        <Button
          type="submit"
          className="h-10 shrink-0 px-4"
          disabled={!username || Boolean(problem) || invite.isPending}
        >
          {invite.isPending ? <Spinner className="text-primary-foreground" /> : <UserPlus data-icon="inline-start" />}
          Invite
        </Button>
      </div>
      <p id="invite-error" role="alert" className="min-h-5 text-sm text-destructive">
        {message}
      </p>
    </form>
  );
}

function MemberRow({ member }: { member: Member }) {
  const { me } = useLive();
  const room = useRoom(member.userId);
  const isMe = member.userId === me.id;
  const playing = Boolean(room?.online && room.state && !room.state.paused);
  const inListenAlong = Boolean(room?.state) || (room?.listeners ?? 0) > 0;
  const status = isMe
    ? "You"
    : playing
      ? "Playing now"
      : room?.online
        ? "Online"
        : inListenAlong
          ? "In a listen along"
          : "Offline";

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar userId={member.userId} username={member.username} live={playing} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">@{member.username}</p>
        <p className={cn("text-xs", playing ? "text-live" : "text-muted-foreground")}>{status}</p>
      </div>
      {member.role === "owner" && (
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Owner</span>
      )}
    </li>
  );
}

function DangerZone({ detail }: { detail: GroupDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const isOwner = detail.group.role === "owner";

  const action = useMutation({
    mutationFn: () => (isOwner ? api.deleteGroup(detail.group.id) : api.leaveGroup(detail.group.id)),
    onSuccess: async () => {
      toast.success(isOwner ? `Deleted ${detail.group.name}.` : `You left ${detail.group.name}.`);
      queryClient.removeQueries({ queryKey: queryKeys.group(detail.group.id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends }),
      ]);
      router.push("/groups");
    },
  });

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-center">
      <div className="flex-1 space-y-0.5">
        <p className="text-sm font-medium">{isOwner ? "Delete group" : "Leave group"}</p>
        <p className="text-xs text-muted-foreground">
          {isOwner
            ? "Removes the group for everyone. This can't be undone."
            : "You can rejoin if someone invites you again."}
        </p>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3"
            onClick={() => setConfirming(false)}
            disabled={action.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 px-3"
            onClick={() => action.mutate()}
            disabled={action.isPending}
          >
            {action.isPending && <Spinner className="text-destructive" />}
            {isOwner ? "Delete for everyone" : "Leave"}
          </Button>
        </div>
      ) : (
        <Button variant="destructive" size="sm" className="h-8 px-3" onClick={() => setConfirming(true)}>
          {isOwner ? "Delete" : "Leave"}
        </Button>
      )}
    </section>
  );
}
