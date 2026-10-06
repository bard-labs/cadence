package config

import (
	"os"
	"strings"
)

type Config struct {
	HTTPAddr       string
	SessionSecret  string
	CORSOrigin     string
	DatabaseURL    string
	RedisURL       string
	S3Endpoint     string
	S3AccessKey    string
	S3SecretKey    string
	S3Bucket       string
	S3UseSSL       bool
	S3PublicURL    string
	WorkerID       string
	FFmpegPath     string
}

func Load() Config {
	useSSL := strings.EqualFold(os.Getenv("CADENCE_S3_USE_SSL"), "true")
	workerID := os.Getenv("CADENCE_WORKER_ID")
	if workerID == "" {
		workerID = "worker-1"
	}
	ffmpeg := os.Getenv("CADENCE_FFMPEG_PATH")
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	return Config{
		HTTPAddr:      env("CADENCE_HTTP_ADDR", ":8080"),
		SessionSecret: env("CADENCE_SESSION_SECRET", "dev-secret-change-me-32-chars-min!!"),
		CORSOrigin:    env("CADENCE_CORS_ORIGIN", "http://localhost:3000"),
		DatabaseURL:   env("CADENCE_DATABASE_URL", "postgres://cadence:cadence@localhost:5433/cadence?sslmode=disable"),
		RedisURL:      env("CADENCE_REDIS_URL", "redis://localhost:6379/0"),
		S3Endpoint:    env("CADENCE_S3_ENDPOINT", "localhost:9000"),
		S3AccessKey:   env("CADENCE_S3_ACCESS_KEY", "cadence"),
		S3SecretKey:   env("CADENCE_S3_SECRET_KEY", "cadence-secret"),
		S3Bucket:      env("CADENCE_S3_BUCKET", "cadence-tracks"),
		S3UseSSL:      useSSL,
		S3PublicURL:   env("CADENCE_S3_PUBLIC_URL", "http://localhost:9000/cadence-tracks"),
		WorkerID:      workerID,
		FFmpegPath:    ffmpeg,
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
