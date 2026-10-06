"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { type KeyboardEvent, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type PersonTab = {
  id: string;
  label: string;
  /** Currently playing something. */
  live?: boolean;
  /** Online but idle. */
  online?: boolean;
};

type Props = {
  tabs: PersonTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  panelId: string;
  className?: string;
};

/**
 * Centered pill of people. Because the pill is centered and every tab animates
 * its layout, adding a person grows the pill outward from the middle while the
 * new tab slides in beside its neighbour.
 */
export function PeopleTabs({ tabs, selectedId, onSelect, panelId, className }: Props) {
  const reduce = useReducedMotion();
  const refs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    refs.current
      .get(selectedId)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [selectedId, reduce]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === selectedId);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next].id;
    onSelect(id);
    refs.current.get(id)?.focus();
  };

  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 34 };

  return (
    <div className={cn("flex w-full justify-center", className)}>
      <LayoutGroup id="people-tabs">
        <motion.div
          layout
          transition={spring}
          role="tablist"
          aria-label="People"
          onKeyDown={onKeyDown}
          className="scrollbar-none flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-white/[0.03] p-1"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {tabs.map((tab, index) => {
              const selected = tab.id === selectedId;
              return (
                <motion.button
                  key={tab.id}
                  ref={(el) => {
                    if (el) refs.current.set(tab.id, el);
                    else refs.current.delete(tab.id);
                  }}
                  layout="position"
                  initial={index === 0 || reduce ? false : { opacity: 0, x: -16, filter: "blur(4px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring}
                  type="button"
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(tab.id)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                    selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="people-tab-indicator"
                      transition={spring}
                      className="absolute inset-0 rounded-full bg-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
                    />
                  )}
                  <span className="relative">{tab.label}</span>
                  {(tab.live || tab.online) && (
                    <span
                      className={cn("relative size-1.5 rounded-full", tab.live ? "bg-live" : "bg-muted-foreground/60")}
                    >
                      <span className="sr-only">{tab.live ? "playing" : "online"}</span>
                    </span>
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
    </div>
  );
}
