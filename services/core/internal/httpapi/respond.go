package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
)

const maxJSONBody = 64 << 10

type apiError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *apiError) Error() string { return e.Code + ": " + e.Message }

func errBadRequest(code, msg string) *apiError {
	return &apiError{Status: http.StatusBadRequest, Code: code, Message: msg}
}

var (
	errUnauthorized = &apiError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "Please sign in again."}
	errNotFound     = &apiError{Status: http.StatusNotFound, Code: "not_found", Message: "Not found."}
	errForbidden    = &apiError{Status: http.StatusForbidden, Code: "forbidden", Message: "You don't have access to this."}
	errInternal     = &apiError{Status: http.StatusInternalServerError, Code: "internal", Message: "Something went wrong on our side. Please try again."}
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError never leaks internal error details to clients; unexpected errors
// are logged with the request ID and returned as a generic 500.
func (a *API) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var ae *apiError
	if !errors.As(err, &ae) {
		a.log.ErrorContext(r.Context(), "request failed", "err", err, "path", r.URL.Path, "request_id", requestID(r))
		ae = errInternal
	}
	writeJSON(w, ae.Status, map[string]*apiError{"error": ae})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "application/json" {
		return &apiError{Status: http.StatusUnsupportedMediaType, Code: "unsupported_media_type", Message: "Expected a JSON body."}
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		switch {
		case errors.As(err, &maxErr):
			return &apiError{Status: http.StatusRequestEntityTooLarge, Code: "body_too_large", Message: "Request body is too large."}
		case errors.Is(err, io.EOF):
			return errBadRequest("invalid_body", "Request body is empty.")
		default:
			return errBadRequest("invalid_body", "Request body is not valid JSON.")
		}
	}
	if dec.More() {
		return errBadRequest("invalid_body", "Request body must contain a single JSON object.")
	}
	return nil
}

func validateText(field, value string, minLen, maxLen int) (string, error) {
	v := strings.TrimSpace(value)
	n := len([]rune(v))
	if n < minLen || n > maxLen {
		return "", errBadRequest("invalid_"+field, fmt.Sprintf("%s must be %d-%d characters.", strings.ToUpper(field[:1])+field[1:], minLen, maxLen))
	}
	if strings.ContainsFunc(v, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
		return "", errBadRequest("invalid_"+field, fmt.Sprintf("%s contains invalid characters.", strings.ToUpper(field[:1])+field[1:]))
	}
	return v, nil
}
