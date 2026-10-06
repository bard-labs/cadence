# ADR-005: Username + password sessions

**Status:** accepted (revised). Guest claim-on-first-use is gone.

## Decision

- Accounts are **username + password**. No email, no OAuth in v1.
- `POST /v1/auth/register` creates the user with a bcrypt hash (cost 12) and issues a session.
- `POST /v1/auth/login` checks the hash. Wrong username and wrong password both return the same 401 `bad_credentials`, so account existence isn't leaked.
- The session token is still 32 random bytes: only `sha256(token)` is stored; the raw token is the `httpOnly` `cadence_session` cookie.
- Passwords are 8–72 characters (bcrypt's byte limit). Usernames stay `^[a-z0-9_]{3,20}$`.

## Why

- Guest names were a demo shortcut, but Take Control and friends imply a real account.
- Username + password is enough for a portfolio listen-along app and keeps the LinkedIn story simple: "no email verification dance."

## Trade-offs

- Forgotten passwords cannot be recovered without email. Acceptable for v1; wipe the account and re-register.
- Migration `004_passwords` deletes existing guest users so every row has a hash.

## Upgrade path

Add OAuth or magic-link later and link it to the same `users.id`.
