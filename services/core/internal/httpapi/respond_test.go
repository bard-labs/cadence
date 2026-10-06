package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSON(t *testing.T) {
	cases := []struct {
		name        string
		contentType string
		body        string
		wantStatus  int
	}{
		{name: "valid", contentType: "application/json", body: `{"name":"a"}`},
		{name: "charset ok", contentType: "application/json; charset=utf-8", body: `{"name":"a"}`},
		{name: "form post blocked", contentType: "application/x-www-form-urlencoded", body: `name=a`, wantStatus: http.StatusUnsupportedMediaType},
		{name: "unknown field", contentType: "application/json", body: `{"name":"a","admin":true}`, wantStatus: http.StatusBadRequest},
		{name: "trailing data", contentType: "application/json", body: `{"name":"a"}{"name":"b"}`, wantStatus: http.StatusBadRequest},
		{name: "empty", contentType: "application/json", body: ``, wantStatus: http.StatusBadRequest},
		{name: "too large", contentType: "application/json", body: `{"name":"` + strings.Repeat("a", maxJSONBody) + `"}`, wantStatus: http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.contentType)
			var dst struct {
				Name string `json:"name"`
			}
			err := decodeJSON(httptest.NewRecorder(), r, &dst)
			if tc.wantStatus == 0 {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			var ae *apiError
			if !errors.As(err, &ae) || ae.Status != tc.wantStatus {
				t.Fatalf("got %v, want status %d", err, tc.wantStatus)
			}
		})
	}
}

func TestValidateText(t *testing.T) {
	if v, err := validateText("name", "  Night Drive  ", 1, 40); err != nil || v != "Night Drive" {
		t.Fatalf("got %q, %v", v, err)
	}
	if _, err := validateText("name", "   ", 1, 40); err == nil {
		t.Fatal("blank name should fail")
	}
	if _, err := validateText("name", strings.Repeat("é", 41), 1, 40); err == nil {
		t.Fatal("41 runes should fail even though bytes differ")
	}
	if _, err := validateText("name", "bad\x00name", 1, 40); err == nil {
		t.Fatal("control characters should fail")
	}
}
