package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
)

const CookieName = "cadence_session"

var (
	ErrInvalidUsername = errors.New("username must be 3-20 characters: lowercase letters, numbers, or underscores")
	usernamePattern    = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
)

// NormalizeUsername lowercases and validates a username. Restricting to ASCII
// avoids look-alike Unicode names impersonating other users.
func NormalizeUsername(raw string) (string, error) {
	u := strings.ToLower(strings.TrimSpace(raw))
	if !usernamePattern.MatchString(u) {
		return "", ErrInvalidUsername
	}
	return u, nil
}

// NewToken returns an opaque session token for the cookie and the hash that is
// stored server-side, so a database leak does not expose usable sessions.
func NewToken() (token string, hash []byte, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(buf)
	return token, HashToken(token), nil
}

func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
