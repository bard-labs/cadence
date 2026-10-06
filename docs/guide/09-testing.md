# Testing

## Fast checks

```bash
make test
```

This runs:

- `go vet` and `go test` (unit tests for tokens, usernames, and the error model)
- Biome on the whole repo
- ESLint (Next.js and React Hooks rules)
- a production `next build`, which also type-checks everything

## API smoke test with curl

Use `bash`, not zsh, for scripts with `$(...)` and UUIDs. Always send `Origin` and JSON headers, because the API requires them for mutations:

```bash
A=http://localhost:8080
H=(-H "Content-Type: application/json" -H "Origin: http://localhost:3000")
curl -s -c a.jar "${H[@]}" -X POST $A/v1/auth/register -d '{"username":"alice_1","password":"password123"}'
curl -s -b a.jar "${H[@]}" -X POST $A/v1/groups -d '{"name":"Night Drive"}'
curl -s -b a.jar $A/v1/friends
```

Cases worth checking by hand:

| Case | Expected |
| --- | --- |
| duplicate username | 409 `username_taken` |
| `Origin: https://evil.example` | 403 |
| form-encoded POST | 415 |
| no cookie | 401, and the cookie is cleared |
| non-member reads a group | 404 |
| owner tries to leave | 409 `owner_cannot_leave` |
| original upload URL fetched directly | 403 (private) |

## End-to-end listen-along (two real browsers)

The project was verified with a Playwright script driving headless Chrome as two users:

1. Login gate. `?next=` is honored. Short usernames and short passwords are rejected; taken usernames get 409 on register.
2. Create a group, invite an unknown name (inline error), invite the friend, and the friend accepts.
3. Upload through the UI, the track becomes ready, and the host plays it.
4. The friend sees the host's tab with a live dot, clicks it, then Listen along.
5. Measured listener-minus-host offset: about 20–30 ms. After the host seeks: still within 30 ms.
6. Host pauses, so the listener pauses. Host resumes, so the listener resumes. Host closes the tab, so the listener shows "went offline" and pauses.
7. Mobile viewport screenshots, then sign out, and `/` redirects to `/login`.

To rerun it, install `playwright-core` somewhere outside the repo and point it at your installed Chrome (`chromium.launch({ channel: "chrome" })`). The script used `--autoplay-policy=no-user-gesture-required --mute-audio`.

## Load

`k6 run deploy/k6/listen-along.js` hits health checks. Extend it to open WebSockets and send `state` messages to load-test the hub.
