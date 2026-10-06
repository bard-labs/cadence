# ADR-002: Go API and worker entrypoints

**Decision:** One module, two binaries: `cmd/api` (HTTP + WebSocket) and `cmd/worker` (ffmpeg jobs).

**Why:** Clear separation of latency-sensitive API from CPU-heavy transcoding without microservice overhead.
