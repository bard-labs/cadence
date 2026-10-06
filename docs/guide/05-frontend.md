# Frontend

## Routing

```
src/proxy.ts                 login gate (runs before every page)
src/app/layout.tsx           <html class="dark">, Inter font, Providers (React Query + toasts)
src/app/(auth)/login         sign-in only, no app chrome
src/app/(app)/layout.tsx     AppShell: session check, LiveProvider, header, nav, player bar
src/app/(app)/page.tsx       Listen (people tabs)
src/app/(app)/library        all tracks, play
src/app/(app)/upload         drag-and-drop upload with progress
src/app/(app)/groups         create, invites, list
src/app/(app)/groups/[id]    invite, members (live status), leave or delete
src/app/error.tsx, (app)/error.tsx, global-error.tsx, not-found.tsx
```

The proxy only checks that the cookie *exists*. Whether the session is *valid* is checked by the API on every request. On 401 the API clears the cookie and `lib/api.ts` redirects to `/login?next=<current page>`.

## Data

- **`lib/api.ts`:**
  - Typed calls with a 15-second timeout
  - `ApiError {status, code, message}`, with friendly messages for network failures and timeouts
  - React Query only retries errors that are worth retrying (network failures, timeouts, 5xx)
- **Mutations:** a global `MutationCache.onError` shows a toast. Forms that render their own inline error pass `meta: { silent: true }`, which skips the toast.
- **Polling:** friends every 15 seconds, invites every 20 seconds, and the Library every 3 seconds while any track is processing.

## Realtime and the player

- **`lib/realtime/socket.ts` (`CadenceSocket`):** reconnects with backoff and jitter, runs the ping and clock loop, and listens for the browser's `online` event.
- **`lib/realtime/store.ts`:** a zustand store holding `rooms[userId]`. It applies snapshots in seq order and tracks the connection status.
- **`features/live/live-provider.tsx`:** creates the socket and engine once per signed-in session, keeps the `watch` list in sync with your friends, and seeds rooms from `/v1/friends`.
- **`features/player/engine.ts` (`PlayerEngine`):** the only code that touches the `<audio>` element. It handles host and listener modes, HLS loading and recovery, drift correction, the Media Session (lock screen controls), and saving your volume.
- **`features/player/player-bar.tsx`:**
  - Fixed at the bottom of the screen; on mobile it sits above the tab bar
  - Hosts get play/pause and a seek bar
  - Listeners get a read-only progress bar and a sync status line ("In sync", "Syncing… +80 ms", or a notice)

The seek bar only seeks when you let go. Dragging would otherwise send dozens of `state` messages and trip the server's rate limit.

## Studio, DJ mode, lyrics, stats (optional)

The normal player bar stays as it was. Extra modes hang off it:

- **Studio** (`features/player/studio-panel.tsx` + `audio-graph.ts`): 10-band EQ, bass / mid / treble, reverb, 8D auto-pan, night compressor, lo-fi, and host-only tempo. Off by default — see ADR-011.
- **Visualizer**: bars, pulse, or matrix rain. Uses a real AnalyserNode when Studio is on; otherwise a synthetic animation so the UI still looks alive.
- **DJ mode**: full-screen now-playing with vinyl and visualizer. A **Lyrics** button toggles the overlay when the file has lyrics. Tap a line to seek (host / shared control).
- **Lyrics**: LRC-aware panel; click a line to jump there when you control playback.
- **Space**: pauses or resumes (ignored while typing in an input).
- **Stats for nerds**: socket, clock offset, RTT, drift sparkline, codec / sample rate / bitrate, buffer ahead.

On iPhone, keep Studio off for Dynamic Island / lock-screen playback. Media Session carries cover art and seek.

## The Listen page

- **`components/ui/people-tabs.tsx`:**
  - A centered pill with "You" first, then friends in the order you became group-mates.
  - Each tab animates its layout, and the pill is centered, so when someone new joins the pill grows outward from the middle and the new tab slides in.
  - A shared `layoutId` indicator glides between tabs.
  - Arrow keys, Home, and End move between tabs, with proper `tablist`/`tab` ARIA roles. On small screens the pill scrolls horizontally.
- **`features/listen/listen-view.tsx`:** the stage under the tabs. When you switch person, it slides left or right depending on whether you moved toward the start or the end of the list.
- **`features/listen/person-stage.tsx`:**
  - Shows a rotating vinyl. If the file had embedded art, that image is the disc. Otherwise it falls back to a stable Unsplash image. The glow uses the person's hue.
  - Shows status (Live now, Paused, Online, Offline), the title, artist / album / year when the file had them, live progress, and the listener count.
  - Offers Listen along, Stop listening, or Play something on your own tab.
  - While listening, **Take control** asks the host. The host gets a toast immediately (Accept / Decline), with no refresh. After an accept, the player bar's play, pause, and seek drive the host's room, and either side can revoke or release. See ADR-010.
  - On your own tab, if you're listening to someone, it shows what you're hearing.

## Styling

- Tailwind v4 with CSS variables in `globals.css`. The app is dark-only. The tokens live on `:root`, so nothing flashes on load.
- **The font:** Inter via `next/font`, exposed as `--font-inter` and mapped to `--font-sans`. The old setup had `--font-sans: var(--font-sans)`, which points at itself, so the browser fell back to a default serif font.
- Layout rules: max width 6xl; the header is sticky; the main area gets bottom padding equal to the nav plus the player bar, so nothing is hidden under fixed bars; safe-area insets apply on iOS.
