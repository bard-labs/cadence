package worker

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
	"github.com/minio/minio-go/v7"
)

type Transcoder struct {
	store  *store.Store
	s3     *storage.S3
	ffmpeg string
}

func NewTranscoder(st *store.Store, s3 *storage.S3, ffmpeg string) *Transcoder {
	return &Transcoder{store: st, s3: s3, ffmpeg: ffmpeg}
}

func (t *Transcoder) RunJob(ctx context.Context, job *store.Job) error {
	if job.Kind != "transcode_hls" {
		return fmt.Errorf("unknown job kind %s", job.Kind)
	}
	trackID, _ := job.Payload["trackId"].(string)
	if trackID == "" {
		return fmt.Errorf("missing trackId")
	}
	originalKey, err := t.store.TrackOriginalKey(ctx, trackID)
	if err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "cadence-hls-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	inputPath := filepath.Join(tmpDir, "input")
	if err := t.downloadObject(ctx, originalKey, inputPath); err != nil {
		_ = t.store.MarkTrackFailed(ctx, trackID)
		return err
	}

	outDir := filepath.Join(tmpDir, "hls")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	manifest := filepath.Join(outDir, "index.m3u8")
	cmd := exec.CommandContext(ctx, t.ffmpeg,
		"-y", "-i", inputPath,
		"-codec:a", "aac", "-b:a", "128k",
		"-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
		manifest,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = t.store.MarkTrackFailed(ctx, trackID)
		return fmt.Errorf("ffmpeg: %v: %s", err, string(out))
	}

	prefix := fmt.Sprintf("hls/%s", trackID)
	if err := t.uploadDir(ctx, outDir, prefix); err != nil {
		_ = t.store.MarkTrackFailed(ctx, trackID)
		return err
	}

	manifestKey := prefix + "/index.m3u8"
	durationMs := 0
	if err := t.store.SetTrackReady(ctx, trackID, manifestKey, durationMs); err != nil {
		return err
	}
	return nil
}

func (t *Transcoder) downloadObject(ctx context.Context, key, dest string) error {
	return t.s3.Client().FGetObject(ctx, t.s3.Bucket(), key, dest, minio.GetObjectOptions{})
}

func (t *Transcoder) uploadDir(ctx context.Context, dir, prefix string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(dir, e.Name())
		objectKey := prefix + "/" + e.Name()
		ct := "application/octet-stream"
		if strings.HasSuffix(e.Name(), ".m3u8") {
			ct = "application/vnd.apple.mpegurl"
		} else if strings.HasSuffix(e.Name(), ".ts") {
			ct = "video/mp2t"
		}
		_, err := t.s3.Client().FPutObject(ctx, t.s3.Bucket(), objectKey, path, minio.PutObjectOptions{ContentType: ct})
		if err != nil {
			return err
		}
	}
	return nil
}
