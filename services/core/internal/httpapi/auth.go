package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/auth"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

func (a *API) guestLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.writeError(w, r, err)
		return
	}
	username, err := auth.NormalizeUsername(body.Username)
	if err != nil {
		a.writeError(w, r, errBadRequest("invalid_username", "Usernames are 3-20 characters: lowercase letters, numbers, or underscores."))
		return
	}

	// Guest names are claimed on first use; re-using a taken name would let
	// anyone sign in as someone else.
	u, err := a.store.CreateUser(r.Context(), username)
	if errors.Is(err, store.ErrConflict) {
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "username_taken", Message: "That username is taken. Try another one."})
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}

	token, hash, err := auth.NewToken()
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	expires := time.Now().Add(a.cfg.SessionTTL)
	if err := a.store.CreateSession(r.Context(), u.ID, hash, expires); err != nil {
		a.writeError(w, r, err)
		return
	}
	a.setSessionCookie(w, token, expires)
	writeJSON(w, http.StatusCreated, u)
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(auth.CookieName); err == nil && c.Value != "" {
		if err := a.store.RevokeSession(r.Context(), auth.HashToken(c.Value)); err != nil {
			a.writeError(w, r, err)
			return
		}
	}
	a.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, currentUser(r))
}
