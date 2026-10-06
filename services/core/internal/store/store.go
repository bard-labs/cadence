package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"createdAt"`
}

type Group struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	OwnerID   string    `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
}

type GroupMember struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Invite struct {
	ID              string    `json:"id"`
	GroupID         string    `json:"groupId"`
	GroupName       string    `json:"groupName"`
	InviterUsername string    `json:"inviterUsername"`
	InviteeUsername string    `json:"inviteeUsername"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
}

type Track struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Status      string    `json:"status"`
	UploaderID  string    `json:"uploaderId"`
	ManifestURL string    `json:"manifestUrl,omitempty"`
	DurationMs  *int      `json:"durationMs,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

type ListeningSession struct {
	UserID     string `json:"userId"`
	Username   string `json:"username"`
	TrackID    string `json:"trackId,omitempty"`
	TrackTitle string `json:"trackTitle,omitempty"`
	PositionMs int    `json:"positionMs"`
	Paused     bool   `json:"paused"`
}

func (s *Store) CreateUser(ctx context.Context, username string) (User, error) {
	id := uuid.New().String()
	row := s.pool.QueryRow(ctx,
		`INSERT INTO users (id, username) VALUES ($1, $2) RETURNING id, username, created_at`,
		id, username,
	)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.CreatedAt); err != nil {
		return User{}, err
	}
	return u, nil
}

func (s *Store) UserByUsername(ctx context.Context, username string) (User, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, username, created_at FROM users WHERE username = $1`, username,
	)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.CreatedAt); err != nil {
		return User{}, err
	}
	return u, nil
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, username, created_at FROM users WHERE id = $1`, id,
	)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.CreatedAt); err != nil {
		return User{}, err
	}
	return u, nil
}

func (s *Store) CreateGroup(ctx context.Context, name, ownerID string) (Group, error) {
	id := uuid.New().String()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Group{}, err
	}
	defer tx.Rollback(ctx)

	var g Group
	if err := tx.QueryRow(ctx,
		`INSERT INTO groups (id, name, owner_id) VALUES ($1, $2, $3) RETURNING id, name, owner_id, created_at`,
		id, name, ownerID,
	).Scan(&g.ID, &g.Name, &g.OwnerID, &g.CreatedAt); err != nil {
		return Group{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
		g.ID, ownerID,
	); err != nil {
		return Group{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Group{}, err
	}
	return g, nil
}

func (s *Store) ListGroupsForUser(ctx context.Context, userID string) ([]Group, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT g.id, g.name, g.owner_id, g.created_at
		FROM groups g
		INNER JOIN group_members gm ON gm.group_id = g.id
		WHERE gm.user_id = $1
		ORDER BY g.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Group
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.OwnerID, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Store) GroupMembers(ctx context.Context, groupID string) ([]GroupMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, gm.role
		FROM group_members gm
		INNER JOIN users u ON u.id = gm.user_id
		WHERE gm.group_id = $1`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupMember
	for rows.Next() {
		var m GroupMember
		if err := rows.Scan(&m.UserID, &m.Username, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) IsGroupMember(ctx context.Context, groupID, userID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)`,
		groupID, userID,
	).Scan(&exists)
	return exists, err
}

func (s *Store) CreateInvite(ctx context.Context, groupID, inviterID, inviteeUsername string) (Invite, error) {
	id := uuid.New().String()
	row := s.pool.QueryRow(ctx, `
		INSERT INTO group_invites (id, group_id, inviter_id, invitee_username)
		VALUES ($1, $2, $3, $4)
		RETURNING id, group_id, inviter_id, invitee_username, status, created_at`,
		id, groupID, inviterID, inviteeUsername,
	)
	var inv Invite
	var inviterIDRaw string
	if err := row.Scan(&inv.ID, &inv.GroupID, &inviterIDRaw, &inv.InviteeUsername, &inv.Status, &inv.CreatedAt); err != nil {
		return Invite{}, err
	}
	_ = s.pool.QueryRow(ctx, `SELECT name FROM groups WHERE id = $1`, groupID).Scan(&inv.GroupName)
	_ = s.pool.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, inviterID).Scan(&inv.InviterUsername)
	return inv, nil
}

func (s *Store) PendingInvitesForUsername(ctx context.Context, username string) ([]Invite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT gi.id, gi.group_id, g.name, u.username, gi.invitee_username, gi.status, gi.created_at
		FROM group_invites gi
		INNER JOIN groups g ON g.id = gi.group_id
		INNER JOIN users u ON u.id = gi.inviter_id
		WHERE gi.invitee_username = $1 AND gi.status = 'pending'
		ORDER BY gi.created_at DESC`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		var inv Invite
		if err := rows.Scan(&inv.ID, &inv.GroupID, &inv.GroupName, &inv.InviterUsername, &inv.InviteeUsername, &inv.Status, &inv.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

func (s *Store) AcceptInvite(ctx context.Context, inviteID, userID, username string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var groupID string
	var invitee string
	err = tx.QueryRow(ctx,
		`SELECT group_id, invitee_username FROM group_invites WHERE id = $1 AND status = 'pending'`,
		inviteID,
	).Scan(&groupID, &invitee)
	if err != nil {
		return err
	}
	if invitee != username {
		return errors.New("invite not for this user")
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		groupID, userID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE group_invites SET status = 'accepted' WHERE id = $1`, inviteID,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) CreateTrack(ctx context.Context, uploaderID, title, originalKey string) (Track, error) {
	id := uuid.New().String()
	row := s.pool.QueryRow(ctx, `
		INSERT INTO tracks (id, uploader_id, title, original_key, status)
		VALUES ($1, $2, $3, $4, 'pending')
		RETURNING id, title, status, uploader_id, created_at`,
		id, uploaderID, title, originalKey,
	)
	var t Track
	if err := row.Scan(&t.ID, &t.Title, &t.Status, &t.UploaderID, &t.CreatedAt); err != nil {
		return Track{}, err
	}
	payload, _ := json.Marshal(map[string]string{"trackId": t.ID})
	_, err := s.pool.Exec(ctx, `
		INSERT INTO jobs (kind, payload) VALUES ('transcode_hls', $1)`, payload)
	if err != nil {
		return Track{}, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE tracks SET status = 'processing' WHERE id = $1`, t.ID); err != nil {
		return Track{}, err
	}
	t.Status = "processing"
	return t, nil
}

func (s *Store) ListTracks(ctx context.Context) ([]Track, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.title, t.status, t.uploader_id, t.duration_ms, t.created_at,
		       tr.manifest_key
		FROM tracks t
		LEFT JOIN track_renditions tr ON tr.track_id = t.id AND tr.variant = 'hls_128'
		ORDER BY t.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTracks(rows)
}

func (s *Store) TrackByID(ctx context.Context, id string) (Track, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT t.id, t.title, t.status, t.uploader_id, t.duration_ms, t.created_at,
		       tr.manifest_key
		FROM tracks t
		LEFT JOIN track_renditions tr ON tr.track_id = t.id AND tr.variant = 'hls_128'
		WHERE t.id = $1`, id)
	return scanTrackRow(row)
}

func scanTracks(rows pgx.Rows) ([]Track, error) {
	var out []Track
	for rows.Next() {
		var t Track
		var manifestKey *string
		if err := rows.Scan(&t.ID, &t.Title, &t.Status, &t.UploaderID, &t.DurationMs, &t.CreatedAt, &manifestKey); err != nil {
			return nil, err
		}
		if manifestKey != nil {
			t.ManifestURL = *manifestKey
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func scanTrackRow(row pgx.Row) (Track, error) {
	var t Track
	var manifestKey *string
	if err := row.Scan(&t.ID, &t.Title, &t.Status, &t.UploaderID, &t.DurationMs, &t.CreatedAt, &manifestKey); err != nil {
		return Track{}, err
	}
	if manifestKey != nil {
		t.ManifestURL = *manifestKey
	}
	return t, nil
}

func (s *Store) UpsertListening(ctx context.Context, userID, trackID string, positionMs int, paused bool) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO listening_sessions (user_id, track_id, position_ms, paused, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE SET
			track_id = EXCLUDED.track_id,
			position_ms = EXCLUDED.position_ms,
			paused = EXCLUDED.paused,
			updated_at = now()`, userID, nullUUID(trackID), positionMs, paused)
	return err
}

func nullUUID(id string) interface{} {
	if id == "" {
		return nil
	}
	return id
}

func (s *Store) ListeningForUsers(ctx context.Context, userIDs []string) ([]ListeningSession, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, ls.track_id, t.title, ls.position_ms, ls.paused
		FROM users u
		LEFT JOIN listening_sessions ls ON ls.user_id = u.id
		LEFT JOIN tracks t ON t.id = ls.track_id
		WHERE u.id = ANY($1)`, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ListeningSession
	for rows.Next() {
		var ls ListeningSession
		var trackID *string
		var title *string
		if err := rows.Scan(&ls.UserID, &ls.Username, &trackID, &title, &ls.PositionMs, &ls.Paused); err != nil {
			return nil, err
		}
		if trackID != nil {
			ls.TrackID = *trackID
		}
		if title != nil {
			ls.TrackTitle = *title
		}
		out = append(out, ls)
	}
	return out, rows.Err()
}

type Job struct {
	ID      string
	Kind    string
	Payload map[string]interface{}
}

func (s *Store) ClaimJob(ctx context.Context, workerID string) (*Job, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx, `
		SELECT id, kind, payload FROM jobs
		WHERE status = 'pending' AND run_at <= now()
		ORDER BY run_at
		FOR UPDATE SKIP LOCKED
		LIMIT 1`)

	var j Job
	var payload []byte
	if err := row.Scan(&j.ID, &j.Kind, &payload); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(payload, &j.Payload); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $2, attempts = attempts + 1, updated_at = now()
		WHERE id = $1`, j.ID, workerID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &j, nil
}

func (s *Store) CompleteJob(ctx context.Context, jobID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1`, jobID)
	return err
}

func (s *Store) FailJob(ctx context.Context, jobID string, errMsg string, retry bool) error {
	if retry {
		_, err := s.pool.Exec(ctx, `
			UPDATE jobs SET status = 'pending', last_error = $2, run_at = now() + interval '30 seconds', updated_at = now()
			WHERE id = $1`, jobID, errMsg)
		return err
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`, jobID, errMsg)
	return err
}

func (s *Store) SetTrackReady(ctx context.Context, trackID string, manifestKey string, durationMs int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO track_renditions (track_id, variant, manifest_key) VALUES ($1, 'hls_128', $2)
		ON CONFLICT (track_id, variant) DO UPDATE SET manifest_key = EXCLUDED.manifest_key`,
		trackID, manifestKey); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE tracks SET status = 'ready', duration_ms = $2 WHERE id = $1`, trackID, durationMs); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) TrackOriginalKey(ctx context.Context, trackID string) (string, error) {
	var key string
	err := s.pool.QueryRow(ctx, `SELECT original_key FROM tracks WHERE id = $1`, trackID).Scan(&key)
	return key, err
}

func (s *Store) MarkTrackFailed(ctx context.Context, trackID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE tracks SET status = 'failed' WHERE id = $1`, trackID)
	return err
}
