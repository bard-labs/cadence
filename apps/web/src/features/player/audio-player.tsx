"use client";

import Hls from "hls.js";
import { useEffect, useRef } from "react";

import { cadenceApi } from "@/lib/api";
import { CadenceSocket, correctDrift, type PlaybackState } from "@/lib/ws/cadence-socket";
import { usePlayerStore } from "@/features/player/player-store";

let sharedSocket: CadenceSocket | null = null;

function getSocket() {
  if (!sharedSocket) {
    sharedSocket = new CadenceSocket();
    sharedSocket.connect();
  }
  return sharedSocket;
}

export function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const track = usePlayerStore((s) => s.currentTrack);
  const isHost = usePlayerStore((s) => s.isHost);
  const hostUserId = usePlayerStore((s) => s.hostUserId);
  const seq = usePlayerStore((s) => s.seq);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track?.manifestUrl || track.status !== "ready") return;

    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(track.manifestUrl);
      hls.attachMedia(audio);
    } else {
      audio.src = track.manifestUrl;
    }

    const socket = getSocket();
    const onTime = () => {
      if (!isHost) return;
      socket.publishState({
        hostUserId: hostUserId ?? "self",
        trackId: track.id,
        positionMs: Math.floor(audio.currentTime * 1000),
        paused: audio.paused,
        rate: audio.playbackRate,
        seq,
      });
      cadenceApi.updateListening(track.id, Math.floor(audio.currentTime * 1000), audio.paused).catch(() => {});
    };

    const interval = setInterval(onTime, 2000);
    audio.addEventListener("play", onTime);
    audio.addEventListener("pause", onTime);

    return () => {
      clearInterval(interval);
      audio.removeEventListener("play", onTime);
      audio.removeEventListener("pause", onTime);
      hls?.destroy();
    };
  }, [track, isHost, hostUserId, seq]);

  useEffect(() => {
    if (isHost) return;
    const audio = audioRef.current;
    if (!audio) return;
    const socket = getSocket();
    const unsub = socket.onMessage((msg) => {
      const state = msg as PlaybackState;
      if (!state.trackId || state.paused === undefined) return;
      const expected = state.positionMs + (socket.serverNow() - state.serverTs);
      correctDrift(audio, expected, audio.currentTime * 1000, socket);
      if (state.paused && !audio.paused) audio.pause();
      if (!state.paused && audio.paused) audio.play().catch(() => {});
    });
    return unsub;
  }, [isHost]);

  if (!track) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-zinc-950/95 backdrop-blur px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <audio ref={audioRef} controls className="w-full" />
        <span className="text-xs text-zinc-500 whitespace-nowrap">{track.title}</span>
      </div>
    </div>
  );
}

export function joinListenAlong(hostUserId: string) {
  const socket = getSocket();
  usePlayerStore.getState().setHost(hostUserId, false);
  socket.joinRoom(hostUserId);
}

export function becomeHost() {
  usePlayerStore.getState().setHost(null, true);
}
