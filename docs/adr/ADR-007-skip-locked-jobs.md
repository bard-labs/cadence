# ADR-007: Job queue in Postgres

**Decision:** `SELECT … FOR UPDATE SKIP LOCKED` on `jobs` table.

**Why:** No Redis/RabbitMQ broker to operate; demonstrates real SQL concurrency patterns in interviews.
