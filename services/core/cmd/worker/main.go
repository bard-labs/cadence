package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/config"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/worker"
)

const (
	maxAttempts = 3
	jobTimeout  = 10 * time.Minute
	jobLease    = 15 * time.Minute
	idlePoll    = 2 * time.Second
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("worker stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	for _, bin := range []string{cfg.FFmpegPath, cfg.FFprobePath} {
		if _, err := exec.LookPath(bin); err != nil {
			return errors.New(bin + " not found on PATH (macOS: brew install ffmpeg)")
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return errors.New("cannot reach Postgres at CADENCE_DATABASE_URL: " + err.Error())
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

	st := store.New(pool)
	tc := worker.NewTranscoder(st, s3, cfg.FFmpegPath, cfg.FFprobePath)
	log.Info("worker started", "id", cfg.WorkerID)

	for {
		job, err := st.ClaimJob(ctx, cfg.WorkerID, jobLease)
		if err != nil && ctx.Err() == nil {
			log.Error("claim job", "err", err)
		}
		if job == nil {
			select {
			case <-ctx.Done():
				log.Info("worker shutting down")
				return nil
			case <-time.After(idlePoll):
			}
			continue
		}
		process(ctx, log, st, tc, job)
	}
}

func process(ctx context.Context, log *slog.Logger, st *store.Store, tc *worker.Transcoder, job *store.Job) {
	jobCtx, cancel := context.WithTimeout(ctx, jobTimeout)
	defer cancel()
	start := time.Now()
	trackID, err := tc.Run(jobCtx, job)

	// Bookkeeping uses a fresh context so a shutdown signal can't strand the job.
	bctx, bcancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer bcancel()

	if err == nil {
		log.Info("job done", "job", job.ID, "track", trackID, "duration_ms", time.Since(start).Milliseconds())
		if err := st.CompleteJob(bctx, job.ID); err != nil {
			log.Error("complete job", "job", job.ID, "err", err)
		}
		return
	}

	var perm *worker.PermanentError
	if errors.As(err, &perm) || job.Attempts >= maxAttempts {
		log.Warn("job failed", "job", job.ID, "track", trackID, "attempt", job.Attempts, "err", err)
		_ = st.FailJob(bctx, job.ID, err.Error())
		if trackID != "" {
			reason := "Processing failed. Please try uploading again."
			if perm != nil {
				reason = perm.Reason
			}
			_ = st.SetTrackFailed(bctx, trackID, reason)
		}
		return
	}

	delay := time.Duration(1<<job.Attempts) * 15 * time.Second
	log.Warn("job will retry", "job", job.ID, "attempt", job.Attempts, "in", delay.String(), "err", err)
	_ = st.RetryJob(bctx, job.ID, err.Error(), delay)
}
