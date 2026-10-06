"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Bottom sheet with a dimmed backdrop. Click outside or Escape closes it.
 *  The header (title + close) stays pinned while the body scrolls. */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  label,
  children,
  className,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Dismiss"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={label ?? title}
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cn(
              "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[min(70dvh,560px)] w-full flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl sm:bottom-24 sm:rounded-3xl",
              wide ? "max-w-3xl" : "max-w-md",
              className,
            )}
          >
            <div className="sticky top-0 z-10 flex shrink-0 items-start gap-3 border-b border-border/50 bg-card/95 px-4 py-3 backdrop-blur-xl sm:px-5">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold tracking-normal">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label={`Close ${title}`}>
                <X />
              </Button>
            </div>
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
