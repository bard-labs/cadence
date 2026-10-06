import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn't exist</h1>
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "h-9 px-4")}>
        Back to Cadence
      </Link>
    </main>
  );
}
