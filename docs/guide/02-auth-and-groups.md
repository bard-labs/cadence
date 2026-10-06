# Auth, groups, invites, friends

## Register and login

`POST /v1/auth/register {"username": "alice", "password": "••••••••"}`  
`POST /v1/auth/login {"username": "alice", "password": "••••••••"}`

1. `auth.NormalizeUsername` trims, lowercases, and validates the name against `^[a-z0-9_]{3,20}$`. The database enforces the same rule with a CHECK constraint.
2. Passwords must be 8–72 characters. Register hashes with bcrypt; login verifies with constant-time compare. Wrong credentials return **401 `bad_credentials`** (no user enumeration beyond that).
3. Register inserts the user. A unique violation (Postgres code `23505`) becomes `store.ErrConflict`, which the handler turns into **409 `username_taken`**.
4. `auth.NewToken()` makes 32 random bytes. The database stores the SHA-256 hash and the browser gets the raw token in the cookie.
5. Register responds **201**, login **200**, both with the user payload.

Auth endpoints are rate-limited. Every protected route goes through `requireSession` (`internal/httpapi/middleware.go`). It reads the cookie, hashes it, and looks up an unexpired, unrevoked session joined to its user. If that fails, it clears the cookie and returns 401.

`POST /v1/auth/logout` revokes the session row and clears the cookie (204).

## Groups

| Route | Notes |
| --- | --- |
| `GET /v1/groups` | Your groups with `role` and `memberCount` |
| `POST /v1/groups {name}` | 1–40 chars. You become owner. You can own at most 20 groups (`group_limit`) |
| `GET /v1/groups/{id}` | `{group, members, invites}`. Returns 404 if you aren't a member, so outsiders can't even confirm the group exists |
| `DELETE /v1/groups/{id}` | Owner only (`not_owner`) |
| `POST /v1/groups/{id}/leave` | Members only. Owners get `owner_cannot_leave` and must delete instead |

## Invites

`POST /v1/groups/{id}/invites {username}` (any member can invite). The error codes are:

- `invalid_username`, `cannot_invite_self`, `user_not_found`
- `already_member`, `already_invited` (a partial unique index allows only one *pending* invite per user per group)
- `group_full` (at most 50 members)

`GET /v1/invites` lists your pending invites. `POST /v1/invites/{id}/accept` and `/decline` respond to one. Accepting runs in a transaction that locks the group row, rechecks capacity, adds the membership, and marks the invite accepted. If the invite isn't yours, or isn't pending, you get `invite_not_found`.

## Friends

`GET /v1/friends` returns everyone who shares at least one group with you. They're ordered by when you first became group-mates, which is the order of the tabs on the Listen page. Each friend includes:

- `groups`: the names of the groups you share
- `lastTrackTitle` and `lastPlayedAt`, from Postgres
- `live`: their current room snapshot from Redis, so tabs render instantly before the WebSocket catches up

## Error shape

Every error looks like `{"error": {"code": "snake_case", "message": "Human sentence."}}`. The web app shows `message` directly and branches on `code` when it needs to. Unexpected errors are logged with the request id and returned as a generic `internal` error, so internal details never reach clients.
