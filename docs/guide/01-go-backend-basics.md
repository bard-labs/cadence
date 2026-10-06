# Go backend basics

- **`cmd/api`** — HTTP server: chi router, middleware, `/v1` REST (register/login with username+password), `/ws` WebSocket, `/metrics` Prometheus.
- **`cmd/worker`** — polls `jobs` with SKIP LOCKED, runs ffmpeg transcodes.
- **`internal/store`** — SQL via pgx, no ORM. See ADR-009. The short version: the important queries are transactions, `SKIP LOCKED`, and `ON CONFLICT`. An ORM would hide those or make us drop to raw SQL for them, and the schema is small enough that a generated query layer (sqlc) is not worth a rewrite yet.
- **`internal/rooms`** — Redis pub/sub + room state keys.

Interview line: *"I separated CPU-bound transcoding from the latency-sensitive API so we can scale workers independently."*
