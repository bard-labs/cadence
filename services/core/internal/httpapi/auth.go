package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/auth"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

type authBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var body authBody
	if err := decodeJSON(w, r, &body); err != nil {
		a.writeError(w, r, err)
		return
	}
	username, password, err := validateCreds(body)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	u, err := a.store.CreateUser(r.Context(), username, hash)
	if errors.Is(err, store.ErrConflict) {
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "username_taken", Message: "That username is taken. Try another one."})
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	a.issueSession(w, r, u, http.StatusCreated)
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var body authBody
	if err := decodeJSON(w, r, &body); err != nil {
		a.writeError(w, r, err)
		return
	}
	username, password, err := validateCreds(body)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	u, hash, err := a.store.UserAuthByUsername(r.Context(), username)
	if errors.Is(err, store.ErrNotFound) || !auth.CheckPassword(hash, password) {
		// Same message either way so account existence isn't leaked.
		a.writeError(w, r, &apiError{Status: http.StatusUnauthorized, Code: "bad_credentials", Message: "Wrong username or password."})
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	a.issueSession(w, r, u, http.StatusOK)
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

func validateCreds(body authBody) (string, string, error) {
	username, err := auth.NormalizeUsername(body.Username)
	if err != nil {
		return "", "", errBadRequest("invalid_username", "Usernames are 3-20 characters: lowercase letters, numbers, or underscores.")
	}
	password, err := auth.NormalizePassword(body.Password)
	if err != nil {
		return "", "", errBadRequest("invalid_password", "Passwords must be 8–72 characters.")
	}
	return username, password, nil
}

func (a *API) issueSession(w http.ResponseWriter, r *http.Request, u store.User, status int) {
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
	writeJSON(w, status, u)
}
