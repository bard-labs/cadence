"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This screen hit an unexpected error. Try again, or reload the page.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground/70">Ref: {error.digest}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="h-9 px-4" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button className="h-9 px-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
