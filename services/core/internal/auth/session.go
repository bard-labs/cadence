package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const cookieName = "cadence_session"

type Session struct {
	UserID   string `json:"uid"`
	Username string `json:"uname"`
	Exp      int64  `json:"exp"`
}

func CookieName() string { return cookieName }

func Sign(secret string, s Session) (string, error) {
	payload, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(enc))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return enc + "." + sig, nil
}

func Verify(secret string, token string) (Session, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Session{}, errors.New("invalid token")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return Session{}, errors.New("bad signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Session{}, err
	}
	var s Session
	if err := json.Unmarshal(raw, &s); err != nil {
		return Session{}, err
	}
	if time.Now().Unix() > s.Exp {
		return Session{}, errors.New("expired")
	}
	return s, nil
}

func NewSession(userID, username string, ttl time.Duration) Session {
	return Session{
		UserID:   userID,
		Username: username,
		Exp:      time.Now().Add(ttl).Unix(),
	}
}
