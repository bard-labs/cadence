# Security checklist (what's done and why)

## Authentication and sessions
- Passwords are bcrypt-hashed. Register and login share the same credential validation.
- Random 256-bit session tokens; only SHA-256 hashes are stored (`sessions.token_hash`).
- The cookie is `httpOnly`, so JavaScript can't read it, and `SameSite=Lax`. Set `CADENCE_COOKIE_SECURE=true` whenever every CORS origin is HTTPS.
- Sign-out revokes the session on the server. Sessions expire after 30 days.
- Register/login are rate-limited per IP.

## CSRF
Three layers:
1. `SameSite=Lax` cookies aren't sent on cross-site POSTs.
2. Mutating requests must be JSON (`Content-Type: application/json`, otherwise 415). A plain HTML form can't send that.
3. If an `Origin` header is present it must match `CADENCE_CORS_ORIGIN`, otherwise 403.

WebSocket upgrades check `Origin` too.

## Authorization
- Group reads return 404 to non-members, so outsiders can't tell whether a group exists.
- Only owners can delete. Only invitees can accept or decline their own invites.
- Listening along requires a shared group, checked on every `listen`. The `watch` list is filtered on the server.
- Track registration requires the object key to be under your own upload prefix.

## Input limits
- JSON bodies are capped at 64 KB, and unknown fields are rejected.
- Text fields are trimmed, length-checked, and reject control characters.
- WebSocket messages are capped at 4 KB, rate-limited, and their numeric fields clamped.
- Uploads are limited by size and content type in the presigned policy, and the real size is checked again after upload.
- ffmpeg can only read local files in known audio container formats.

## Infrastructure
- Only `hls/*` is public in storage.
- API responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and CORP same-site.
- The web app sends a Content Security Policy. Scripts and styles come only from itself, and connections are allowed only to the API, the WebSocket, and media origins. It also sends `frame-ancestors 'none'` and a Permissions-Policy, adds HSTS when served over HTTPS, and hides `X-Powered-By`.
- `X-Forwarded-For` is trusted only when `CADENCE_TRUST_PROXY=true`, so clients can't spoof IPs to dodge rate limits.
- Docker images run as a non-root user.
- Internal errors are logged with a request id, and clients only get a generic message.

## Production config
Setting `CADENCE_ENV=production` with only HTTPS CORS origins refuses to start unless `CADENCE_COOKIE_SECURE=true`. Home LAN deploys that also allow `http://192.168.x.x` may keep Secure cookies off so browsers on the LAN can keep the session. Prefer a single HTTPS origin in public deployments. Serve the web app and the API on the same site (for example `cadence.example.com`) and set `CADENCE_COOKIE_DOMAIN` when the cookie must cross subdomains.

## Not done yet (good next steps)
- CSP nonces instead of `'unsafe-inline'` for scripts.
- Signed URLs for HLS, so playback is limited to signed-in users.
- Account recovery or OAuth linking.
- Audit logging for group membership changes.
