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
	"unicode/utf8"

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

	probed, err := t.probe(ctx, input)
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
	if probed.coverStream >= 0 {
		coverPath := filepath.Join(dir, "cover.jpg")
		if err := t.extractCover(ctx, input, probed.coverStream, coverPath); err == nil {
			key := prefix + "/cover.jpg"
			if err := t.s3.Upload(ctx, key, coverPath, "image/jpeg", "public, max-age=31536000, immutable"); err == nil {
				probed.meta.CoverKey = key
			}
		}
	}
	return trackID, t.store.SetTrackReady(ctx, trackID, prefix+"/index.m3u8", int(probed.duration.Milliseconds()), probed.meta)
}

// probedFile is what ffprobe can tell us before we re-encode. A missing cover
// is not a failure: the track still becomes playable.
type probedFile struct {
	duration    time.Duration
	meta        store.TrackMeta
	coverStream int
}

func (t *Transcoder) probe(ctx context.Context, input string) (probedFile, error) {
	cmd := exec.CommandContext(ctx, t.ffprobe,
		"-v", "error",
		"-protocol_whitelist", "file",
		"-format_whitelist", formatWhitelist,
		"-show_entries", "format=duration,bit_rate:format_tags:stream=codec_type,codec_name,sample_rate,channels,bit_rate:stream_tags:stream_disposition=attached_pic",
		"-of", "json", input,
	)
	raw, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return probedFile{}, ctx.Err()
		}
		return probedFile{}, &PermanentError{Reason: "this file isn't a supported audio format"}
	}
	probed, err := parseProbe(raw)
	if err != nil {
		return probedFile{}, err
	}
	return probed, nil
}

func (t *Transcoder) extractCover(ctx context.Context, input string, stream int, dest string) error {
	cmd := exec.CommandContext(ctx, t.ffmpeg,
		"-hide_banner", "-nostdin", "-loglevel", "error", "-y",
		"-protocol_whitelist", "file",
		"-format_whitelist", formatWhitelist,
		"-i", input,
		"-map", fmt.Sprintf("0:%d", stream),
		"-frames:v", "1",
		"-vf", "scale=600:600:force_original_aspect_ratio=increase,crop=600:600",
		"-q:v", "4",
		dest,
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("cover: %s", firstLine(string(output)))
	}
	return nil
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

const maxLyricsBytes = 20 * 1024

type ffprobeDoc struct {
	Streams []struct {
		CodecType   string            `json:"codec_type"`
		CodecName   string            `json:"codec_name"`
		SampleRate  string            `json:"sample_rate"`
		Channels    int               `json:"channels"`
		BitRate     string            `json:"bit_rate"`
		Tags        map[string]string `json:"tags"`
		Disposition struct {
			AttachedPic int `json:"attached_pic"`
		} `json:"disposition"`
	} `json:"streams"`
	Format struct {
		Duration string            `json:"duration"`
		BitRate  string            `json:"bit_rate"`
		Tags     map[string]string `json:"tags"`
	} `json:"format"`
}

func parseProbe(raw []byte) (probedFile, error) {
	var doc ffprobeDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return probedFile{}, &PermanentError{Reason: "could not read audio metadata"}
	}
	out := probedFile{coverStream: -1}
	tags := map[string]string{}
	var audio *struct {
		codec      string
		sampleRate int
		channels   int
		bitRate    int
	}
	for i, s := range doc.Streams {
		mergeTags(tags, s.Tags)
		if s.Disposition.AttachedPic == 1 && out.coverStream < 0 {
			out.coverStream = i
		}
		if s.CodecType == "audio" && audio == nil {
			sr, _ := strconv.Atoi(s.SampleRate)
			br, _ := strconv.Atoi(s.BitRate)
			audio = &struct {
				codec      string
				sampleRate int
				channels   int
				bitRate    int
			}{codec: s.CodecName, sampleRate: sr, channels: s.Channels, bitRate: br}
		}
	}
	if audio == nil {
		return probedFile{}, &PermanentError{Reason: "the file has no audio stream"}
	}
	secs, err := strconv.ParseFloat(doc.Format.Duration, 64)
	if err != nil || secs <= 0 {
		return probedFile{}, &PermanentError{Reason: "could not determine track length"}
	}
	out.duration = time.Duration(secs * float64(time.Second))
	if out.duration > maxDuration {
		return probedFile{}, &PermanentError{Reason: "tracks can be at most 2 hours long"}
	}
	mergeTags(tags, doc.Format.Tags)
	br := audio.bitRate
	if br <= 0 {
		br, _ = strconv.Atoi(doc.Format.BitRate)
	}
	out.meta = store.TrackMeta{
		Title:      clip(tags["title"], 120),
		Artist:     clip(firstTag(tags, "artist", "album_artist"), 200),
		Album:      clip(tags["album"], 200),
		Year:       parseYear(firstTag(tags, "date", "year")),
		Genre:      clip(tags["genre"], 80),
		Lyrics:     clipBytes(lyricsFrom(tags), maxLyricsBytes),
		Codec:      clip(audio.codec, 40),
		SampleRate: audio.sampleRate,
		Channels:   audio.channels,
		Bitrate:    br,
	}
	return out, nil
}

func mergeTags(dst map[string]string, src map[string]string) {
	for k, v := range src {
		key := strings.ToLower(strings.TrimSpace(k))
		if key == "" || strings.TrimSpace(v) == "" {
			continue
		}
		// Format tags win over stream tags: they are written second.
		dst[key] = v
	}
}

func firstTag(tags map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(tags[k]); v != "" {
			return v
		}
	}
	return ""
}

func lyricsFrom(tags map[string]string) string {
	if v := firstTag(tags, "lyrics-eng", "lyrics", "unsyncedlyrics"); v != "" {
		return v
	}
	for k, v := range tags {
		if strings.HasPrefix(k, "lyrics") && strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parseYear(s string) int {
	s = strings.TrimSpace(s)
	if len(s) < 4 {
		return 0
	}
	n, err := strconv.Atoi(s[:4])
	if err != nil || n < 1000 || n > 9999 {
		return 0
	}
	return n
}

func clip(s string, maxRunes int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\x00", ""))
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	r := []rune(s)
	return string(r[:maxRunes])
}

func clipBytes(s string, max int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\x00", ""))
	if len(s) <= max {
		return s
	}
	for max > 0 && !utf8.RuneStart(s[max]) {
		max--
	}
	return s[:max]
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
