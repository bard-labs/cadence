package worker

import (
	"errors"
	"strings"
	"testing"
)

func TestParseProbeReadsTagsCoverAndLyrics(t *testing.T) {
	raw := []byte(`{
		"streams": [
			{
				"codec_type": "audio",
				"codec_name": "mp3",
				"sample_rate": "44100",
				"channels": 2,
				"bit_rate": "320000",
				"disposition": {"attached_pic": 0},
				"tags": {"title": "stream title"}
			},
			{
				"codec_type": "video",
				"codec_name": "mjpeg",
				"disposition": {"attached_pic": 1}
			}
		],
		"format": {
			"duration": "125.5",
			"bit_rate": "328000",
			"tags": {
				"title": "Neon Highway",
				"artist": "Bard Labs",
				"album": "Night Drive EP",
				"date": "2026-01-02",
				"genre": "Synthwave",
				"lyrics-eng": "[00:01.00]hello\n[00:02.00]there"
			}
		}
	}`)
	got, err := parseProbe(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.duration.Milliseconds() != 125500 {
		t.Fatalf("duration %d", got.duration.Milliseconds())
	}
	if got.coverStream != 1 {
		t.Fatalf("cover stream %d", got.coverStream)
	}
	if got.meta.Title != "Neon Highway" || got.meta.Artist != "Bard Labs" || got.meta.Year != 2026 {
		t.Fatalf("meta %+v", got.meta)
	}
	if got.meta.Codec != "mp3" || got.meta.SampleRate != 44100 || got.meta.Channels != 2 || got.meta.Bitrate != 320000 {
		t.Fatalf("audio %+v", got.meta)
	}
	if !strings.Contains(got.meta.Lyrics, "[00:01.00]hello") {
		t.Fatalf("lyrics %q", got.meta.Lyrics)
	}
}

func TestParseProbeRejectsVideoOnly(t *testing.T) {
	_, err := parseProbe([]byte(`{"streams":[{"codec_type":"video"}],"format":{"duration":"3"}}`))
	var permanent *PermanentError
	if !errors.As(err, &permanent) {
		t.Fatalf("got %v", err)
	}
}

func TestClipBytesKeepsRuneBoundary(t *testing.T) {
	s := strings.Repeat("a", 5) + "é"
	if got := clipBytes(s, 6); got != strings.Repeat("a", 5) {
		t.Fatalf("split rune: %q", got)
	}
}
