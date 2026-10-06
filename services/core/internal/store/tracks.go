package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

type Track struct {
	ID               string    `json:"id"`
	Title            string    `json:"title"`
	Status           string    `json:"status"`
	UploaderID       string    `json:"uploaderId"`
	UploaderUsername string    `json:"uploaderUsername"`
	ManifestKey      string    `json:"-"`
	ManifestURL      string    `json:"manifestUrl,omitempty"`
	DurationMs       *int      `json:"durationMs"`
	Error            *string   `json:"error"`
	CreatedAt        time.Time `json:"createdAt"`
}

const trackColumns = `
	t.id, t.title, t.status, t.uploader_id, u.username, coalesce(tr.manifest_key, ''),
	t.duration_ms, t.error, t.created_at`

const trackFrom = `
	FROM tracks t
	JOIN users u ON u.id = t.uploader_id
	LEFT JOIN track_renditions tr ON tr.track_id = t.id AND tr.variant = 'hls_aac'`

func scanTrack(r pgx.Row) (Track, error) {
	var t Track
	err := r.Scan(&t.ID, &t.Title, &t.Status, &t.UploaderID, &t.UploaderUsername, &t.ManifestKey,
		&t.DurationMs, &t.Error, &t.CreatedAt)
	return t, err
}

// CreateTrack inserts the track and its transcode job atomically, so a track
// can never be stuck in "processing" without a job to process it.
func (s *Store) CreateTrack(ctx context.Context, uploaderID, title, originalKey string, size int64) (string, error) {
	var id string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO tracks (uploader_id, title, original_key, size_bytes, status)
			VALUES ($1, $2, $3, $4, 'processing') RETURNING id`,
			uploaderID, title, originalKey, size,
		).Scan(&id); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"trackId": id})
		_, err := tx.Exec(ctx, `INSERT INTO jobs (kind, payload) VALUES ('transcode_hls', $1)`, payload)
		return err
	})
	return id, mapErr(err)
}

func (s *Store) ListTracks(ctx context.Context, limit int) ([]Track, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+trackColumns+trackFrom+` ORDER BY t.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Track, error) { return scanTrack(r) })
}

func (s *Store) TrackByID(ctx context.Context, id string) (Track, error) {
	t, err := scanTrack(s.pool.QueryRow(ctx, `SELECT `+trackColumns+trackFrom+` WHERE t.id = $1`, id))
	return t, mapErr(err)
}

func (s *Store) TrackOriginalKey(ctx context.Context, trackID string) (string, error) {
	var key string
	err := s.pool.QueryRow(ctx, `SELECT original_key FROM tracks WHERE id = $1`, trackID).Scan(&key)
	return key, mapErr(err)
}

func (s *Store) SetTrackReady(ctx context.Context, trackID, manifestKey string, durationMs int) error {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO track_renditions (track_id, variant, manifest_key) VALUES ($1, 'hls_aac', $2)
			ON CONFLICT (track_id, variant) DO UPDATE SET manifest_key = EXCLUDED.manifest_key`,
			trackID, manifestKey); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`UPDATE tracks SET status = 'ready', duration_ms = $2, error = NULL WHERE id = $1`,
			trackID, durationMs)
		return err
	})
	return mapErr(err)
}

func (s *Store) SetTrackFailed(ctx context.Context, trackID, reason string) error {
	_, err := s.pool.Exec(ctx, `UPDATE tracks SET status = 'failed', error = $2 WHERE id = $1`, trackID, reason)
	return mapErr(err)
}

func (s *Store) UpsertListening(ctx context.Context, userID, trackID string, positionMs int64, paused bool) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO listening_sessions (user_id, track_id, position_ms, paused, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE SET
			track_id = EXCLUDED.track_id,
			position_ms = EXCLUDED.position_ms,
			paused = EXCLUDED.paused,
			updated_at = now()`, userID, trackID, positionMs, paused)
	return mapErr(err)
}
