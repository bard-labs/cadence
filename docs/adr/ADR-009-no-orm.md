# ADR-009: SQL with pgx, not an ORM

**Context:** The Go service has a small schema (users, sessions, groups, invites, tracks, jobs, listening sessions) and a few queries that are the product: a transactional track-plus-job insert, `FOR UPDATE SKIP LOCKED` job claims, and `ON CONFLICT` upserts.

**Decision:** Hand-written SQL through pgx. Goose owns the schema. Handlers never build queries; `internal/store` does.

**Why not an ORM (GORM, ent, Bun):**

- The queries we care about are locking, conflict handling, and multi-statement transactions. An ORM either hides that SQL or drops you into a raw-query escape hatch, which is the code we would have written anyway.
- Go ORMs map rows with reflection. A column added in a migration can silently scan into the wrong field. pgx `Scan` fails the build's tests the moment the column list and the struct disagree, because both are written next to each other.
- There is no object graph to lazy-load. A track's uploader is one join. An ORM's convenience (preload, soft delete, callbacks) would be unused machinery.

**Why not sqlc:** sqlc generates Go from SQL and would remove the hand-written `Scan` lists. Worth it if the store grows past a couple of dozen queries. It is not an ORM, and it is not worth a rewrite of every query while the schema is still this small.

**Consequences:** Adding a column means a migration, the `SELECT` list, and the `Scan` arguments. That is the whole tax.
