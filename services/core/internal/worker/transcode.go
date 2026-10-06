package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

// Only real audio containers may be demuxed. Without this, a crafted "audio"
// file that is actually an HLS or concat playlist could make ffmpeg read local
// files or internal URLs.
const formatWhitelist = "mp3,wav,flac,ogg,mov,matroska,aac,aiff,w64"

const maxDuration = 2 * time.Hour

// PermanentError marks failures that retrying cannot fix, such as an invalid file.
type PermanentError struct{ Reason string }

func (e *PermanentError) Error() string { return e.Reason }

type Transcoder struct {
	store   *store.Store
	s3      *storage.S3
	ffmpeg  string
	ffprobe string
}

func NewTranscoder(st *store.Store, s3 *storage.S3, ffmpeg, ffprobe string) *Transcoder {
	return &Transcoder{store: st, s3: s3, ffmpeg: ffmpeg, ffprobe: ffprobe}
}

func (t *Transcoder) Run(ctx context.Context, job *store.Job) (trackID string, err error) {
	if job.Kind != "transcode_hls" {
		return "", &PermanentError{Reason: "unknown job kind " + job.Kind}
	}
	var payload struct {
		TrackID string `json:"trackId"`
	}
	if err := json.Unmarshal(job.Payload, &payload); err != nil || payload.TrackID == "" {
		return "", &PermanentError{Reason: "invalid job payload"}
	}
	trackID = payload.TrackID

	originalKey, err := t.store.TrackOriginalKey(ctx, trackID)
	if errors.Is(err, store.ErrNotFound) {
		return trackID, &PermanentError{Reason: "track was deleted"}
	}
	if err != nil {
		return trackID, err
	}

	dir, err := os.MkdirTemp("", "cadence-hls-*")
	if err != nil {
		return trackID, err
	}
	defer os.RemoveAll(dir)

	input := filepath.Join(dir, "input")
	if err := t.s3.Download(ctx, originalKey, input); err != nil {
		return trackID, fmt.Errorf("download original: %w", err)
	}

	duration, err := t.probe(ctx, input)
	if err != nil {
		return trackID, err
	}

	out := filepath.Join(dir, "hls")
	if err := os.Mkdir(out, 0o755); err != nil {
		return trackID, err
	}
	cmd := exec.CommandContext(ctx, t.ffmpeg,
		"-hide_banner", "-nostdin", "-loglevel", "error",
		"-protocol_whitelist", "file",
		"-format_whitelist", formatWhitelist,
		"-i", input,
		"-map", "0:a:0", "-vn",
		"-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "44100",
		"-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
		"-hls_segment_filename", filepath.Join(out, "seg_%04d.ts"),
		filepath.Join(out, "index.m3u8"),
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return trackID, ctx.Err()
		}
		return trackID, &PermanentError{Reason: "could not transcode audio: " + firstLine(string(output))}
	}

	prefix := "hls/" + trackID
	if err := t.uploadHLS(ctx, out, prefix); err != nil {
		return trackID, fmt.Errorf("upload hls: %w", err)
	}
	return trackID, t.store.SetTrackReady(ctx, trackID, prefix+"/index.m3u8", int(duration.Milliseconds()))
}

func (t *Transcoder) probe(ctx context.Context, input string) (time.Duration, error) {
	cmd := exec.CommandContext(ctx, t.ffprobe,
		"-v", "error",
		"-protocol_whitelist", "file",
		"-format_whitelist", formatWhitelist,
		"-show_entries", "format=duration:stream=codec_type",
		"-of", "json", input,
	)
	raw, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, &PermanentError{Reason: "this file isn't a supported audio format"}
	}
	var res struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return 0, &PermanentError{Reason: "could not read audio metadata"}
	}
	hasAudio := false
	for _, s := range res.Streams {
		if s.CodecType == "audio" {
			hasAudio = true
		}
	}
	if !hasAudio {
		return 0, &PermanentError{Reason: "the file has no audio stream"}
	}
	secs, err := strconv.ParseFloat(res.Format.Duration, 64)
	if err != nil || secs <= 0 {
		return 0, &PermanentError{Reason: "could not determine track length"}
	}
	d := time.Duration(secs * float64(time.Second))
	if d > maxDuration {
		return 0, &PermanentError{Reason: "tracks can be at most 2 hours long"}
	}
	return d, nil
}

// uploadHLS uploads segments before the playlist, so a visible playlist always
// points at segments that exist.
func (t *Transcoder) uploadHLS(ctx context.Context, dir, prefix string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var playlist string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			continue
		}
		if strings.HasSuffix(name, ".m3u8") {
			playlist = name
			continue
		}
		if err := t.s3.Upload(ctx, prefix+"/"+name, filepath.Join(dir, name), "video/mp2t", "public, max-age=31536000, immutable"); err != nil {
			return err
		}
	}
	if playlist == "" {
		return errors.New("ffmpeg produced no playlist")
	}
	return t.s3.Upload(ctx, prefix+"/"+playlist, filepath.Join(dir, playlist), "application/vnd.apple.mpegurl", "public, max-age=300")
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}
