package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type Job struct {
	ID       string
	Kind     string
	Payload  json.RawMessage
	Attempts int
}

// ClaimJob locks one runnable job. SKIP LOCKED lets many workers poll the same
// table without blocking each other; jobs stuck in "running" past the lease are
// reclaimed so a crashed worker cannot strand them.
func (s *Store) ClaimJob(ctx context.Context, workerID string, lease time.Duration) (*Job, error) {
	var j Job
	err := s.pool.QueryRow(ctx, `
		UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1,
		                attempts = attempts + 1, updated_at = now()
		WHERE id = (
			SELECT id FROM jobs
			WHERE (status = 'pending' AND run_at <= now())
			   OR (status = 'running' AND locked_at < now() - make_interval(secs => $2))
			ORDER BY run_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id, kind, payload, attempts`, workerID, lease.Seconds(),
	).Scan(&j.ID, &j.Kind, &j.Payload, &j.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (s *Store) CompleteJob(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = $1`, id)
	return err
}

func (s *Store) RetryJob(ctx context.Context, id, errMsg string, delay time.Duration) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE jobs SET status = 'pending', last_error = $2, locked_at = NULL, locked_by = NULL,
		                run_at = now() + make_interval(secs => $3), updated_at = now()
		WHERE id = $1`, id, errMsg, delay.Seconds())
	return err
}

func (s *Store) FailJob(ctx context.Context, id, errMsg string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`, id, errMsg)
	return err
}
