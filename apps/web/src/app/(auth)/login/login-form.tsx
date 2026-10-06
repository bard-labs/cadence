"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api, errorMessage } from "@/lib/api";
import { normalizeUsername, usernameProblem } from "@/lib/format";

function loginError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case "username_taken":
      return "That name is already taken. Try another one.";
    case "rate_limited":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return err.message;
  }
}

export function LoginForm({ next }: { next: string }) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const name = normalizeUsername(username);
  const problem = usernameProblem(name);

  const login = useMutation({
    mutationFn: () => api.guestLogin(name),
    meta: { silent: true },
    // Full navigation so the proxy sees the new cookie and every cache starts fresh.
    onSuccess: () => window.location.assign(next),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem || name.length === 0 || login.isPending) return;
    login.mutate();
  };

  const fieldError = touched ? (problem ?? (name.length === 0 ? "Enter a username." : null)) : null;
  const message = fieldError ?? (login.isError ? loginError(login.error) : null);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <label htmlFor={id} className="sr-only">
        Username
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          @
        </span>
        <Input
          id={id}
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
            if (login.isError) login.reset();
          }}
          onBlur={() => name.length > 0 && setTouched(true)}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? `${id}-error` : undefined}
          className="h-11 pl-7 text-base sm:text-sm"
        />
      </div>
      <p id={`${id}-error`} role="alert" className="min-h-5 text-sm text-destructive">
        {message}
      </p>
      <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={login.isPending}>
        {login.isPending ? <Spinner className="text-primary-foreground" label="Signing in" /> : "Continue"}
        {!login.isPending && <ArrowRight data-icon="inline-end" />}
      </Button>
    </form>
  );
}
