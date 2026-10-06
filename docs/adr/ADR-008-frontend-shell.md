# ADR-008: Frontend shell, login gate, and one audio engine

**Status:** accepted

## Decision

1. **Login first.** `src/proxy.ts` (Next 16's name for middleware) redirects to `/login?next=…` when there's no `cadence_session` cookie, and redirects `/login` to the app when there is one. `next` is validated, so only same-site paths are allowed and it can't be used as an open redirect.
2. **Route groups.** `(auth)` holds only the login page. `(app)` holds everything else and shares a client `AppShell`. The shell:
   - Loads `/v1/me` (showing a spinner, then an error screen with retry if it fails)
   - Mounts **one** `LiveProvider`, which owns the WebSocket, the realtime store, and the `PlayerEngine`
   - Renders the header, the mobile bottom nav, and the player bar
3. **One `<audio>` element** for the whole app, controlled by `PlayerEngine` (a plain TS class, not React state). React only reads from the zustand `usePlayer` store.
4. **The Listen page is people-centric.** A centered pill of tabs: **You** first, then each friend (everyone you share a group with). New friends slide out from the center. Switching tabs slides the stage left or right, depending on direction.
5. **Sign-in and sign-out are full page navigations.** That drops every cache, the socket, and the player from the previous session.

## Why

- A proxy-level gate means `/login` is the first screen, and no signed-in UI flashes for logged-out users.
- Keeping the engine outside React avoids re-render loops and keeps timing-sensitive code (drift correction) deterministic.
- Route groups keep the login page free of the app shell without any conditional layout code.
