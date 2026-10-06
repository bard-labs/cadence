# ADR-010: Shared control is live room state, not a database grant

**Context:** A listener should be able to ask the person they're listening to for control, the host should see that ask immediately, and after an accept both of them can play, pause, seek, and change the track.

**Decision:**

- The ask is a direct WebSocket message to the host's connections (`control_request`). It is not stored in Postgres and it is not broadcast to everyone watching the room. It expires after 2 minutes.
- An accept adds the listener's user id to a Redis set on the host's room. The next room snapshot includes `controllers`, so every client updates without a refresh.
- Either the host or a controller may publish `state`. The snapshot records `by` so clients can tell a remote change from their own echo.
- The host can revoke. The controller can release. Leaving the listen, the host stopping, or the last tab closing on either side removes the grant.
- Equalizer, reverb, and the other listening effects are not part of this. They run in the browser and do not change the HLS bytes friends receive. Playback rate is the exception, because it is already a field on room state, so a slowed or sped room stays in sync.

**Consequences:** A restart of Redis drops grants the same way it drops "what is playing". That matches the rest of live state. Sharing control does not let someone publish into a room they were not accepted into, and it does not survive leaving the group: the listen ends, and ending the listen drops the grant.
