"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { PeopleTabs, type PersonTab } from "@/components/ui/people-tabs";
import { ErrorState } from "@/components/ui/state";
import { PersonStage } from "@/features/listen/person-stage";
import { useFriends, useLive } from "@/features/live/live-provider";
import { useRealtime } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";

const PANEL_ID = "person-panel";

export function ListenView() {
  const { me } = useLive();
  const friends = useFriends();
  const rooms = useRealtime((s) => s.rooms);
  const reduce = useReducedMotion();

  const people = useMemo(
    () => [
      { id: me.id, username: me.username, isMe: true as const },
      ...(friends.data ?? []).map((f) => ({ id: f.userId, username: f.username, isMe: false as const, friend: f })),
    ],
    [me, friends.data],
  );

  const tabs: PersonTab[] = people.map((p) => {
    const room = rooms[p.id];
    return {
      id: p.id,
      label: p.isMe ? "You" : p.username,
      live: Boolean(room?.online && room.state && !room.state.paused),
      online: !p.isMe && Boolean(room?.online),
    };
  });

  const [selection, setSelection] = useState({ id: me.id, direction: 1 });
  const selectedId = people.some((p) => p.id === selection.id) ? selection.id : me.id;
  const person = people.find((p) => p.id === selectedId) ?? people[0];
  const direction = selection.direction;

  const select = (id: string) => {
    const order = (x: string) => people.findIndex((p) => p.id === x);
    setSelection((prev) => ({ id, direction: order(id) >= order(prev.id) ? 1 : -1 }));
  };

  const offset = reduce ? 0 : 48;

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <PeopleTabs tabs={tabs} selectedId={selectedId} onSelect={select} panelId={PANEL_ID} />

      <section id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${selectedId}`} className="relative overflow-x-clip">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={selectedId}
            custom={direction}
            variants={{
              enter: (d: number) => ({ x: d * offset, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -offset, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.32, 0.72, 0, 1] }}
          >
            <PersonStage person={person} />
          </motion.div>
        </AnimatePresence>
      </section>

      {friends.isError && !friends.data && <ErrorState error={friends.error} onRetry={() => friends.refetch()} />}

      {friends.data?.length === 0 && (
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-border bg-card/50 px-6 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Users className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Bring your friends</p>
            <p className="text-sm text-muted-foreground">
              Create a group and invite people by username. Each friend gets a tab here so you can see what they're
              playing and listen along.
            </p>
          </div>
          <Link href="/groups" className={cn(buttonVariants({ variant: "outline" }), "h-9 px-4")}>
            Create a group
          </Link>
        </div>
      )}
    </div>
  );
}
