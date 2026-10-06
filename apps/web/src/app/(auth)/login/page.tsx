import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { safeNext } from "@/lib/redirect";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-5 text-center">
          <Logo />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Listen together</h1>
            <p className="text-sm text-muted-foreground">Username and password. No email.</p>
          </div>
        </div>
        <LoginForm next={safeNext(typeof next === "string" ? next : null)} />
        <p className="text-center text-xs text-muted-foreground">
          Create an account once, then sign in from any browser with the same username and password.
        </p>
      </div>
    </main>
  );
}
