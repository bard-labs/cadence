# Architecture

```
 Browser (Next.js app)
   │  REST  (cookie: cadence_session)        ┌──────────────┐
   ├────────────────────────────────────────►│              │──► Postgres  users, sessions, groups,
   │  WebSocket /ws  (same cookie)            │   Go API     │              invites, tracks, jobs
   ├────────────────────────────────────────►│  (cmd/api)   │──► Redis     live room state, presence,
   │                                          │              │              pub/sub fan-out
   │  presigned POST (upload original)        └──────────────┘
   ├──────────────────────────► MinIO / S3 ◄──── Worker (cmd/worker)
   │  GET hls/*.m3u8 + .ts (public read)          claims jobs, ffprobe + ffmpeg → HLS
   └──────────────────────────►
```

## The pieces

**Web app.** Every page except `/login` needs a session. `src/proxy.ts` redirects to `/login` when the session cookie is missing. Signed-in pages share one shell, which holds the header, the player bar, and a single WebSocket and audio engine. Navigating between pages never interrupts the music.

**API.** A stateless HTTP server, so you can run several. It handles:

- Auth, groups, invites, upload presigning, and track registration
- The WebSocket hub, which tracks who is online, what each person is playing, and who is listening to whom

**Worker.** Claims transcode jobs from Postgres with `FOR UPDATE SKIP LOCKED`, so several workers never grab the same job. For each job it downloads the original, validates it with ffprobe, transcodes it to HLS (AAC, 6-second segments), and uploads the result to `hls/<trackId>/`. Failures retry with backoff, up to 3 attempts.

**Postgres.** The source of truth for anything that must survive a restart.

**Redis.** Holds live, ephemeral state:

- `cadence:room:<userId>:state`: what that person is playing, with a server timestamp
- `cadence:room:<userId>:seq`: a counter that only goes up, so clients can drop out-of-order updates
- `cadence:room:<userId>:listeners`: who is listening along
- `cadence:presence:<userId>`: a hash of open connections with a TTL, used for online/offline
- `cadence:events`: a pub/sub channel. Every API instance subscribes and forwards updates to its own sockets, which is how two people connected to different API instances still see each other.

**MinIO.** An S3-compatible object store. Original uploads (`uploads/<userId>/...`) are private. Only `hls/*` is publicly readable.

## Key flows

**Sign in.** POST `/v1/auth/register` or `/v1/auth/login` with `{username, password}` → the API creates or verifies the user, opens a session, and sets an httpOnly cookie → the browser navigates to `/`.

**Upload.**

1. POST `/v1/uploads` returns a presigned POST policy (limited by size and content type).
2. The browser uploads directly to MinIO, with a progress bar.
3. POST `/v1/tracks {title, objectKey}`. In one transaction this creates the track (status `processing`) and a job.
4. The worker transcodes, then sets the track to `ready` and records its duration.

**Listen along.**

1. The host plays a track. Their browser sends `state` messages carrying the position, a paused flag, the playback rate, and the server time when the position was captured.
2. The API stores them in Redis and publishes on `cadence:events`.
3. A friend clicks Listen along, which sends `listen`. The API checks that they share a group, adds them to the listeners set, and sends back the room snapshot.
4. The friend's player loads the same HLS stream and computes where the host is right now: `position + (serverNow − capturedAt) × rate`. It then corrects drift every second.

Details are in `guide/04-realtime-sync.md`.
