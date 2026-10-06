# Setup guide

## Tools

- **pnpm workspaces:** one lockfile. `apps/web` is `@bardlabs/cadence-web` and `packages/protocol` is `@bardlabs/cadence-protocol`.
- **shadcn-style UI:** primitives live in `apps/web/src/components/ui` (alias `@/components/ui`).
- **Biome:** lint and format for TS, JSON, and CSS (`pnpm check`). **ESLint** adds the Next.js and React Hooks rules (`pnpm --filter @bardlabs/cadence-web lint`).
- **lefthook + commitlint:** conventional commit messages. A hook blocks messages mentioning `Co-authored-by` or `cursor`.
- **Docker Compose:** Postgres 16 (host port **5433**), Redis 7 (6379), and MinIO (9000 API, 9001 console, login `cadence` / `cadence-secret`).

## First run

```bash
make env                                              # creates .env from .env.example
pnpm install
cp apps/web/.env.local.example apps/web/.env.local
make dev
```

`make dev` runs `make up` (Docker infra) and `go mod tidy`, then starts three processes in parallel:

- **API** on :8080. On startup it runs the embedded SQL migrations, creates the MinIO bucket, and sets the public-read policy on `hls/*`.
- **Worker.** It needs `ffmpeg` and `ffprobe` on PATH and exits with a clear message if they're missing.
- **Web** on :3000.

## Health checks

- `curl localhost:8080/healthz` checks that the process is up.
- `curl localhost:8080/readyz` checks Postgres, Redis, and storage, and returns 503 if any is down.
- `curl localhost:8080/metrics` exposes the Prometheus metrics.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `docker.sock: no such file` | Start Docker Desktop and wait until it's ready |
| `role "cadence" does not exist` | You're connecting to a **local** Postgres on 5432. Docker's is on **5433** (see `.env`) |
| `arm64e.x1-macos` linker error | The Makefile already sets `CGO_ENABLED=0`. If it still fails, use `make dev-api-docker` / `make dev-worker-docker` |
| Worker says `ffmpeg not found` | `brew install ffmpeg` |
| `Invalid project directory ... #` | You ran `pnpm dev # comment`. Run commands without trailing comments |
| Login works but the app bounces back to `/login` | The API isn't reachable or the cookie was cleared. Check `curl localhost:8080/readyz` |
| "Couldn't load this stream" | MinIO isn't running, or `CADENCE_S3_PUBLIC_URL` is wrong |
| Upload fails with "rejected by storage" | Check that MinIO CORS allows `http://localhost:3000` (set in compose) |
| `CADENCE_COOKIE_SECURE must be true when all CORS origins are https` | Every `CADENCE_CORS_ORIGIN` is HTTPS, so Secure cookies are required |
