# Realtime sync: how listen-along works

This is the heart of Cadence. The code is in `services/core/internal/realtime` (server) and `apps/web/src/lib/realtime` plus `apps/web/src/features/player/engine.ts` (client).

## 1. Connecting

The browser opens `ws://localhost:8080/ws`. The cookie authenticates the upgrade, and the Origin header must equal `CADENCE_CORS_ORIGIN` so other sites can't open sockets with your cookie.

Per connection, the server:

- caps each user at 5 sockets
- limits messages to 4 KB each, at 20 per second with bursts of 40 (slow down or get disconnected)
- gives each client a buffered send queue of 64 messages. If a client can't keep up, it's disconnected rather than allowed to block everyone. It reconnects and resyncs from a fresh snapshot.
- closes connections that send nothing for 60 seconds. The client pings every 15 seconds.

**Presence:** each connection writes `connId → timestamp` into the Redis hash `cadence:presence:<userId>`, with a 90-second TTL refreshed on every ping. You're "online" when that hash isn't empty.

## 2. Messages

Client to server:

| type | purpose |
| --- | --- |
| `ping {t0}` | clock sync and heartbeat. The server replies `pong {t0, ts}` |
| `watch {roomIds}` | which friends' rooms to receive updates for. The server filters this to people you actually share a group with, and always includes you |
| `listen {roomId}` | start listening along to a friend (requires a shared group) |
| `leave` | stop listening along |
| `state {trackId, positionMs, paused, rate, capturedAt, roomId?}` | publish playback. Omit `roomId` for your own room. Set it to drive a room you were granted control of |
| `stop` | the host stops (clears their room and every shared-control grant) |
| `control_request {roomId}` | listener asks the host for control. Delivered only to the host, live |
| `control_respond {userId, accept}` | host accepts or declines |
| `control_revoke {userId}` | host takes the grant back |
| `control_release {roomId}` | controller gives the grant back and keeps listening |
| `drift {driftMs}` | listener telemetry, recorded in the `cadence_sync_drift_ms` histogram |

Server to client: `room {roomId, seq, state, listeners, online, controllers}`, `listening {roomId}`, `pong`, `error {code, message, roomId?}`, and three direct messages that are not broadcast to the room: `control_request {roomId, from, username}`, `control_result {roomId, accepted}`, `control_revoked {roomId}`.

`state.by` is the user who published that snapshot. `controllers` is the list of user ids, besides the host, allowed to publish into the room. Grants live in Redis (`cadence:room:<hostId>:controllers`), same lifetime as the room, not in Postgres. A request expires after 2 minutes if the host never answers. Leaving, the host stopping, the host's last tab closing, or the controller's last tab closing all drop the grant. The room snapshot updates immediately, so nobody has to refresh to see the request or the new controller.

## 3. Clock sync (NTP-style)

Your laptop's clock and your friend's phone clock can disagree by seconds. So every timestamp in a room uses **server time**.

```
client sends  ping { t0 = performance.now() }
server replies pong { t0, ts = server Date.now() }
client:  rtt    = performance.now() - t0
         offset = ts - (Date.now() - rtt/2)
         serverNow() = Date.now() + offset
```

The client sends 4 quick pings on connect, then one every 15 seconds. It keeps the last 8 samples and trusts the one with the **lowest RTT**, because a fast round trip has the least queuing delay distorting it (`lib/realtime/clock.ts`).

## 4. Host side

When you play a track, `PlayerEngine` goes into host mode. On every `play`, `pause`, `seeked`, `ratechange`, `playing`, and `ended` event, plus a heartbeat every 5 seconds, it sends:

```
state { trackId, positionMs: audio.currentTime*1000, paused, rate, capturedAt: serverNow() }
```

The server:

- checks that the track exists and is `ready`
- clamps the values
- replaces a `capturedAt` more than 5 seconds off the server's own time
- stores the state in Redis, increments `seq`, and publishes on `cadence:events`

Every API instance receives the publish and forwards it to its local sockets that watch that room.

"Last played" goes to Postgres only when the track or paused state changes, not on every heartbeat.

## 5. Listener side

**Listen along** sends `listen`. The engine:

1. Waits for the host's room snapshot.
2. Fetches the track (`GET /v1/tracks/{id}`) and loads its HLS stream.
3. Computes where the host is **now**: `expected = positionMs + (serverNow − capturedAt) × rate`.
4. Seeks there and plays.

Then, every second:

```
drift = myPosition - expected
|drift| ≤ 40 ms     → fine, playbackRate = host rate
40 ms < |drift| ≤ 400 → nudge playbackRate by up to ±3% to catch up smoothly
|drift| > 400 ms    → hard seek
```

Nudging is inaudible; seeking is a small skip. Real-world results in the end-to-end test: the listener stays **within 20–30 ms** of the host, including right after the host seeks.

### Edge cases handled

- **Host pauses:** the listener pauses at the same position and shows "<host> paused."
- **Host closes their last tab:** the server freezes the room (paused at the computed position), sets `online: false`, and the listener shows "went offline".
- **Host switches tracks:** the listener loads the new track automatically.
- **Autoplay blocked by the browser:** the status becomes `blocked`, with a "Tap play" button that resyncs.
- **The listener pauses locally (media keys, headphones):** it stops following until they press play, then catches up.
- **Socket reconnects:** the client re-sends `watch` and `listen`, and the host re-publishes its state. Reconnects use exponential backoff with jitter, and retry immediately when the browser comes back online.
- **Out-of-order snapshots:** ignored, using `seq`.
- **You leave a shared group mid-session:** the next `watch` sees you're no longer friends and sends `listen_ended`.
- **You start playing your own music:** you stop listening along (and the server enforces it).

## 6. Scaling

The API is stateless apart from open sockets. Room state lives in Redis and fan-out uses one pub/sub channel, so you can run N API instances behind a load balancer. Sticky sessions aren't required.
