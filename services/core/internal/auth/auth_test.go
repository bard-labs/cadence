package auth

import (
	"bytes"
	"testing"
)

func TestNormalizeUsername(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{in: "Bardia", want: "bardia"},
		{in: "  dj_42 ", want: "dj_42"},
		{in: "ab", wantErr: true},
		{in: "this_name_is_way_too_long", wantErr: true},
		{in: "bad-name", wantErr: true},
		{in: "bаrdia", wantErr: true}, // Cyrillic "а"
		{in: "", wantErr: true},
	}
	for _, tc := range cases {
		got, err := NormalizeUsername(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("NormalizeUsername(%q) = %q, want error", tc.in, got)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("NormalizeUsername(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
}

func TestNewTokenHashMatches(t *testing.T) {
	token, hash, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(HashToken(token), hash) {
		t.Fatal("hash of token does not match stored hash")
	}
	other, _, _ := NewToken()
	if other == token {
		t.Fatal("tokens must be unique")
	}
}
