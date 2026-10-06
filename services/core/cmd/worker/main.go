package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/config"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/worker"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg := config.Load()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	s3, err := storage.New(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket, cfg.S3UseSSL, cfg.S3PublicURL)
	if err != nil {
		log.Error("s3", "err", err)
		os.Exit(1)
	}

	st := store.New(pool)
	tc := worker.NewTranscoder(st, s3, cfg.FFmpegPath)

	log.Info("worker started", "id", cfg.WorkerID)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, err := st.ClaimJob(ctx, cfg.WorkerID)
			if err != nil {
				log.Error("claim job", "err", err)
				continue
			}
			if job == nil {
				continue
			}
			log.Info("running job", "id", job.ID, "kind", job.Kind)
			if err := tc.RunJob(ctx, job); err != nil {
				log.Error("job failed", "id", job.ID, "err", err)
				retry := job.Payload != nil
				_ = st.FailJob(ctx, job.ID, err.Error(), retry)
				continue
			}
			_ = st.CompleteJob(ctx, job.ID)
		}
	}
}
