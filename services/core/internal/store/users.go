package store

import (
	"context"
	"time"
)

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Store) CreateUser(ctx context.Context, username string) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (username) VALUES ($1) RETURNING id, username, created_at`,
		username,
	).Scan(&u.ID, &u.Username, &u.CreatedAt)
	return u, mapErr(err)
}

func (s *Store) UserByUsername(ctx context.Context, username string) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`SELECT id, username, created_at FROM users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &u.CreatedAt)
	return u, mapErr(err)
}

func (s *Store) CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, expiresAt,
	)
	return mapErr(err)
}

func (s *Store) SessionUser(ctx context.Context, tokenHash []byte) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.username, u.created_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
		tokenHash,
	).Scan(&u.ID, &u.Username, &u.CreatedAt)
	return u, mapErr(err)
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
		tokenHash,
	)
	return mapErr(err)
}
