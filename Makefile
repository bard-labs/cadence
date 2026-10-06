.PHONY: up down up-all check-docker tidy dev-api dev-worker dev-web

COMPOSE = docker compose -f deploy/docker-compose.yml

check-docker:
	@docker info >/dev/null 2>&1 || { \
		echo ""; \
		echo "Docker is not running. Start Docker Desktop, wait until it is ready, then run make up again."; \
		echo ""; \
		exit 1; \
	}

up: check-docker
	$(COMPOSE) up -d postgres redis minio

down:
	$(COMPOSE) down

up-all: check-docker
	$(COMPOSE) up -d --build

tidy:
	cd services/core && go mod tidy

dev-api: tidy
	cd services/core && CADENCE_HTTP_ADDR=:8080 go run ./cmd/api

dev-worker: tidy
	cd services/core && go run ./cmd/worker

dev-web:
	pnpm --filter @bardlabs/cadence-web dev
