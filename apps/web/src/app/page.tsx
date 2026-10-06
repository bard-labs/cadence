"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SpatialProductShowcase from "@/components/ui/spatial-product-showcase";
import { cadenceApi } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await cadenceApi.guestLogin(username.trim());
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 pt-10 pb-24">
        <p className="text-[10px] uppercase tracking-[0.35em] text-zinc-500 mb-2">BardLabs</p>
        <h1 className="text-3xl font-semibold mb-2">Cadence</h1>
        <p className="text-zinc-400 max-w-lg mb-10">Listen along with friends. Upload tracks, form groups, sync playback in real time.</p>
        <SpatialProductShowcase />
        <form onSubmit={onSubmit} className="mt-12 max-w-md mx-auto flex flex-col gap-3">
          <label className="text-sm text-zinc-400" htmlFor="username">Guest username</label>
          <Input
            id="username"
            placeholder="pick a name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={32}
            required
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Entering…" : "Enter Cadence"}
          </Button>
        </form>
      </div>
    </div>
  );
}
