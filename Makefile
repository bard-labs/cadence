.PHONY: up down dev-api dev-worker dev-web migrate

COMPOSE = docker compose -f deploy/docker-compose.yml

up:
	$(COMPOSE) up -d postgres redis minio minio-init

down:
	$(COMPOSE) down

up-all:
	$(COMPOSE) up -d --build

dev-api:
	cd services/core && CADENCE_HTTP_ADDR=:8080 go run ./cmd/api

dev-worker:
	cd services/core && go run ./cmd/worker

dev-web:
	pnpm dev

migrate:
	cd services/core && go run ./cmd/api 2>/dev/null || true
