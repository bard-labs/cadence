package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env            string
	HTTPAddr       string
	TrustProxy     bool
	SessionTTL     time.Duration
	CookieSecure   bool
	CookieDomain   string
	// AllowedOrigins is CADENCE_CORS_ORIGIN split on commas (LAN + public).
	AllowedOrigins []string
	DatabaseURL    string
	RedisURL       string
	S3Endpoint     string
	S3PublicHost   string
	S3AccessKey    string
	S3SecretKey    string
	S3Bucket       string
	S3UseSSL       bool
	S3PublicUseSSL bool
	S3PublicURL    string
	MaxUploadBytes int64
	WorkerID       string
	FFmpegPath     string
	FFprobePath    string
}

func (c Config) IsProduction() bool { return c.Env == "production" }

// OriginAllowed reports whether the browser Origin header is on the allow-list.
func (c Config) OriginAllowed(origin string) bool {
	for _, o := range c.AllowedOrigins {
		if o == origin {
			return true
		}
	}
	return false
}

func splitOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSuffix(strings.TrimSpace(p), "/")
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func Load() (Config, error) {
	cfg := Config{
		Env:            env("CADENCE_ENV", "development"),
		HTTPAddr:       env("CADENCE_HTTP_ADDR", ":8080"),
		TrustProxy:     envBool("CADENCE_TRUST_PROXY", false),
		SessionTTL:     30 * 24 * time.Hour,
		CookieSecure:   envBool("CADENCE_COOKIE_SECURE", false),
		CookieDomain:   os.Getenv("CADENCE_COOKIE_DOMAIN"),
		AllowedOrigins: splitOrigins(env("CADENCE_CORS_ORIGIN", "http://localhost:3000")),
		DatabaseURL:    env("CADENCE_DATABASE_URL", "postgres://cadence:cadence@localhost:5433/cadence?sslmode=disable"),
		RedisURL:       env("CADENCE_REDIS_URL", "redis://localhost:6379/0"),
		S3Endpoint:     env("CADENCE_S3_ENDPOINT", "localhost:9000"),
		S3PublicHost:   os.Getenv("CADENCE_S3_PUBLIC_ENDPOINT"),
		S3AccessKey:    env("CADENCE_S3_ACCESS_KEY", "cadence"),
		S3SecretKey:    env("CADENCE_S3_SECRET_KEY", "cadence-secret"),
		S3Bucket:       env("CADENCE_S3_BUCKET", "cadence-tracks"),
		S3UseSSL:       envBool("CADENCE_S3_USE_SSL", false),
		// Defaults to the internal flag so local/dev keeps one switch; production
		// sets CADENCE_S3_PUBLIC_USE_SSL=true while keeping internal MinIO on HTTP.
		S3PublicUseSSL: envBool("CADENCE_S3_PUBLIC_USE_SSL", envBool("CADENCE_S3_USE_SSL", false)),
		S3PublicURL:    strings.TrimSuffix(env("CADENCE_S3_PUBLIC_URL", "http://localhost:9000/cadence-tracks"), "/"),
		MaxUploadBytes: envInt("CADENCE_MAX_UPLOAD_MB", 50) * 1024 * 1024,
		WorkerID:       env("CADENCE_WORKER_ID", hostnameOr("worker-1")),
		FFmpegPath:     env("CADENCE_FFMPEG_PATH", "ffmpeg"),
		FFprobePath:    env("CADENCE_FFPROBE_PATH", "ffprobe"),
	}
	if cfg.S3PublicHost == "" {
		cfg.S3PublicHost = cfg.S3Endpoint
	}
	return cfg, cfg.validate()
}

func (c Config) validate() error {
	var errs []error
	if c.Env != "development" && c.Env != "production" {
		errs = append(errs, fmt.Errorf("CADENCE_ENV must be development or production, got %q", c.Env))
	}
	if len(c.AllowedOrigins) == 0 {
		errs = append(errs, errors.New("CADENCE_CORS_ORIGIN must list at least one origin"))
	}
	if c.IsProduction() {
		// Home LAN may use http://192.168.x.x alongside https://public. Only
		// require Secure cookies when every allowed origin is HTTPS.
		allHTTPS := true
		for _, o := range c.AllowedOrigins {
			if !strings.HasPrefix(o, "https://") {
				allHTTPS = false
				break
			}
		}
		if allHTTPS && !c.CookieSecure {
			errs = append(errs, errors.New("CADENCE_COOKIE_SECURE must be true when all CORS origins are https"))
		}
	}
	if c.MaxUploadBytes <= 0 {
		errs = append(errs, errors.New("CADENCE_MAX_UPLOAD_MB must be positive"))
	}
	return errors.Join(errs...)
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return v
}

func envInt(key string, fallback int64) int64 {
	v, err := strconv.ParseInt(os.Getenv(key), 10, 64)
	if err != nil {
		return fallback
	}
	return v
}

func hostnameOr(fallback string) string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return fallback
}
