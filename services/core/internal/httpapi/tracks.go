package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

func (a *API) withURL(t store.Track) store.Track {
	if t.Status == "ready" {
		t.ManifestURL = a.s3.PublicURL(t.ManifestKey)
		t.CoverURL = a.s3.PublicURL(t.CoverKey)
	}
	return t
}

func (a *API) createUpload(w http.ResponseWriter, r *http.Request) {
	target, err := a.s3.PresignUpload(r.Context(), currentUser(r).ID, a.cfg.MaxUploadBytes)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, target)
}

func (a *API) createTrack(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var body struct {
		Title     string `json:"title"`
		TitleAuto bool   `json:"titleAuto"`
		ObjectKey string `json:"objectKey"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.writeError(w, r, err)
		return
	}
	title, err := validateText("title", body.Title, 1, 120)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	// Keys are issued per user by createUpload; refuse anything else so users
	// cannot register someone else's upload.
	if !strings.HasPrefix(body.ObjectKey, storage.UploadPrefix(me.ID)) || strings.Contains(body.ObjectKey, "..") {
		a.writeError(w, r, errBadRequest("invalid_upload", "That upload doesn't belong to you."))
		return
	}
	size, err := a.s3.ObjectSize(r.Context(), body.ObjectKey)
	if errors.Is(err, storage.ErrObjectMissing) {
		a.writeError(w, r, errBadRequest("upload_missing", "We couldn't find your upload. Please upload the file again."))
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	if size > a.cfg.MaxUploadBytes {
		a.writeError(w, r, errBadRequest("upload_too_large", "That file is too large."))
		return
	}
	id, err := a.store.CreateTrack(r.Context(), me.ID, title, body.TitleAuto, body.ObjectKey, size)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	t, err := a.store.TrackByID(r.Context(), id)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, a.withURL(t))
}

func (a *API) listTracks(w http.ResponseWriter, r *http.Request) {
	tracks, err := a.store.ListTracks(r.Context(), 200)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	for i := range tracks {
		tracks[i] = a.withURL(tracks[i])
	}
	writeJSON(w, http.StatusOK, nonNil(tracks))
}

func (a *API) getTrack(w http.ResponseWriter, r *http.Request) {
	t, err := a.store.TrackByID(r.Context(), chi.URLParam(r, "trackID"))
	if errors.Is(err, store.ErrNotFound) {
		a.writeError(w, r, &apiError{Status: http.StatusNotFound, Code: "track_not_found", Message: "This track doesn't exist."})
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a.withURL(t))
}
