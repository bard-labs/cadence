"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Toaster, toast } from "sonner";

import { ApiError, errorMessage } from "@/lib/api";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { silent?: boolean };
  }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (count, err) => count < 2 && (!(err instanceof ApiError) || err.retryable),
        retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent) return;
        if (err instanceof ApiError && err.status === 401) return;
        toast.error(errorMessage(err));
      },
    }),
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        theme="dark"
        position="top-center"
        offset={{ top: 68 }}
        mobileOffset={{ top: 64 }}
        toastOptions={{
          classNames: {
            toast: "!bg-popover !text-popover-foreground !border-border !rounded-xl !font-sans",
            description: "!text-muted-foreground",
          },
        }}
      />
    </QueryClientProvider>
  );
}
