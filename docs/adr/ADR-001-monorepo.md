# ADR-001: Monorepo layout

**Context:** Frontend and backend evolve together; shared protocol types help.

**Decision:** pnpm workspaces (`apps/web`, `packages/protocol`) + Go module at `services/core`, orchestrated with `Makefile` and `deploy/docker-compose.yml`.

**Consequences:** Single clone runs the full stack; Go and Node toolchains required locally.
