.PHONY: up down up-all check-docker tidy dev dev-api dev-worker dev-web dev-api-docker dev-worker-docker env test

COMPOSE = docker compose -f deploy/docker-compose.yml

# Load repo-root .env when present (copy from .env.example)
ifneq (,$(wildcard .env))
include .env
export
endif

GO_ENV = CGO_ENABLED=0

check-docker:
	@docker info >/dev/null 2>&1 || { \
		echo ""; \
		echo "Docker is not running. Start Docker Desktop, wait until it is ready, then run make up again."; \
		echo ""; \
		exit 1; \
	}

env:
	@test -f .env || cp .env.example .env
	@echo "Created .env from .env.example (edit if needed)."

up: check-docker
	$(COMPOSE) up -d postgres redis minio
	@echo ""
	@echo "Postgres is on localhost:5433 (not 5432). Run: make env   if you have no .env yet."
	@echo ""

down:
	$(COMPOSE) down

up-all: check-docker
	$(COMPOSE) up -d --build

tidy:
	cd services/core && go mod tidy

# Local Go (needs CGO_ENABLED=0 on some Mac SDK setups)
dev-api: tidy
	cd services/core && $(GO_ENV) CADENCE_HTTP_ADDR=:8080 go run ./cmd/api

dev-worker: tidy
	cd services/core && $(GO_ENV) go run ./cmd/worker

# API + worker in Docker (use when local go link fails)
dev-api-docker: check-docker
	$(COMPOSE) up -d --build api

dev-worker-docker: check-docker
	$(COMPOSE) up -d --build worker

dev-web:
	pnpm --filter @bardlabs/cadence-web dev

# Infra in Docker, then API + worker + web together. Ctrl+C stops all three.
dev: up tidy
	@$(MAKE) --no-print-directory -j3 dev-api-run dev-worker-run dev-web

dev-api-run:
	cd services/core && $(GO_ENV) go run ./cmd/api

dev-worker-run:
	cd services/core && $(GO_ENV) go run ./cmd/worker

test:
	cd services/core && $(GO_ENV) go vet ./... && $(GO_ENV) go test ./...
	pnpm exec biome check .
	pnpm --filter @bardlabs/cadence-web lint
	pnpm --filter @bardlabs/cadence-web build
