"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api, errorMessage } from "@/lib/api";
import { normalizeUsername, usernameProblem } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

function authError(err: unknown, mode: Mode): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case "username_taken":
      return "That name is already taken. Try another one.";
    case "bad_credentials":
      return "Wrong username or password.";
    case "invalid_password":
      return "Passwords must be 8–72 characters.";
    case "rate_limited":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return err.message || (mode === "register" ? "Couldn't create the account." : "Couldn't sign in.");
  }
}

export function LoginForm({ next }: { next: string }) {
  const userId = useId();
  const passId = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const name = normalizeUsername(username);
  const problem = usernameProblem(name);
  const passwordProblem =
    password.length === 0 ? "Enter a password." : password.length < 8 ? "At least 8 characters." : null;

  const auth = useMutation({
    mutationFn: () => (mode === "register" ? api.register(name, password) : api.login(name, password)),
    meta: { silent: true },
    // Full navigation so the proxy sees the new cookie and every cache starts fresh.
    onSuccess: () => window.location.assign(next),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem || passwordProblem || name.length === 0 || auth.isPending) return;
    auth.mutate();
  };

  const fieldError = touched ? (problem ?? passwordProblem ?? (name.length === 0 ? "Enter a username." : null)) : null;
  const message = fieldError ?? (auth.isError ? authError(auth.error, mode) : null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1">
        {(
          [
            ["login", "Sign in"],
            ["register", "Create account"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              "h-9 rounded-lg text-sm transition-colors",
              mode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setMode(id);
              auth.reset();
              setTouched(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor={userId} className="text-xs font-medium text-muted-foreground">
            Username
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
              @
            </span>
            <Input
              id={userId}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              maxLength={24}
              placeholder="your_name"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase());
                if (auth.isError) auth.reset();
              }}
              onBlur={() => name.length > 0 && setTouched(true)}
              aria-invalid={Boolean(message && problem)}
              className="h-11 pl-7 text-base sm:text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={passId} className="text-xs font-medium text-muted-foreground">
            Password
          </label>
          <Input
            id={passId}
            name="password"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            maxLength={72}
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (auth.isError) auth.reset();
            }}
            onBlur={() => setTouched(true)}
            aria-invalid={Boolean(message && passwordProblem)}
            className="h-11 text-base sm:text-sm"
          />
        </div>

        <p id={`${userId}-error`} role="alert" className="min-h-5 text-sm text-destructive">
          {message}
        </p>

        <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={auth.isPending}>
          {auth.isPending ? (
            <Spinner className="text-primary-foreground" label={mode === "register" ? "Creating" : "Signing in"} />
          ) : mode === "register" ? (
            "Create account"
          ) : (
            "Sign in"
          )}
          {!auth.isPending && <ArrowRight data-icon="inline-end" />}
        </Button>
      </form>
    </div>
  );
}
