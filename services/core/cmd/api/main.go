package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/config"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/db"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/httpapi"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/realtime"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("api stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := db.Migrate(cfg.DatabaseURL); err != nil {
		return fmt.Errorf("cannot migrate Postgres at CADENCE_DATABASE_URL (is `make up` running?): %w", err)
	}

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	st := store.New(pool)

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("invalid CADENCE_REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("cannot reach Redis at CADENCE_REDIS_URL: %w", err)
	}

	s3, err := storage.New(storage.Options{
		Endpoint: cfg.S3Endpoint, PublicEndpoint: cfg.S3PublicHost,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey,
		Bucket: cfg.S3Bucket, UseSSL: cfg.S3UseSSL, PublicUseSSL: cfg.S3PublicUseSSL,
		PublicURL: cfg.S3PublicURL,
	})
	if err != nil {
		return err
	}
	if err := s3.EnsureBucket(ctx); err != nil {
		return fmt.Errorf("cannot prepare storage bucket at CADENCE_S3_ENDPOINT: %w", err)
	}

	hub := realtime.NewHub(rdb, st, log, cfg.AllowedOrigins...)
	if err := hub.Start(ctx); err != nil {
		return fmt.Errorf("realtime hub: %w", err)
	}

	srv := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: httpapi.New(cfg, log, st, s3, rdb, hub).Router(),
		// No ReadTimeout/WriteTimeout: they would also cut hijacked WebSocket
		// connections. Bodies are bounded by MaxBytesReader and the /v1 timeout.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	srv.RegisterOnShutdown(hub.Shutdown)

	errc := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", cfg.HTTPAddr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
