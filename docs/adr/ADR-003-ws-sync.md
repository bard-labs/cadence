# ADR-003: Host-authoritative sync over WebSockets

**Status:** accepted

## Decision

- Each user has one "room", keyed by their user id. Only that user (the host) can write its state.
- The state is a snapshot: `{trackId, positionMs, capturedAt, paused, rate}`, where `capturedAt` is **server** time in ms.
- Listeners never ask "where are you?" They extrapolate: `position = positionMs + (serverNow − capturedAt) × rate`.
- Clients estimate `serverNow` with NTP-style ping/pong and keep the sample with the lowest round-trip time.
- Each snapshot carries `seq`, which only increases, so clients ignore anything older than what they already have.
- The host re-sends state on every play, pause, seek, or rate change, plus a heartbeat every 5 seconds.
- When the host's last tab disconnects, the server **freezes** the room: it computes the current position and marks the room paused. Listeners pause instead of drifting on without a host.

## Why

- Sending snapshots instead of commands is self-healing. A listener who joins late, or reconnects, only needs the latest snapshot.
- Server time removes clock differences between devices.
- Redis pub/sub lets multiple API instances share rooms.

## Alternatives considered

- **WebRTC mesh:** better latency, but much more complexity, and it doesn't scale to many listeners.
- **Server-side mixing/streaming:** a true radio model, but it's expensive and needs a media server.

## Message reference

See `packages/protocol/src/index.ts`. It mirrors `services/core/internal/realtime/protocol.go`.
