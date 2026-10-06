package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/auth"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

type ctxKey int

const userKey ctxKey = 1

func requestID(r *http.Request) string {
	return middleware.GetReqID(r.Context())
}

func currentUser(r *http.Request) store.User {
	return r.Context().Value(userKey).(store.User)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Resource-Policy", "same-site")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// sameOrigin rejects state-changing requests from other origins. Together with
// SameSite=Lax cookies and the JSON content-type requirement this blocks CSRF.
func (a *API) sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if origin := r.Header.Get("Origin"); origin != "" && origin != a.cfg.AllowedOrigin {
				a.writeError(w, r, errForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		if r.URL.Path == "/healthz" || r.URL.Path == "/metrics" {
			return
		}
		a.log.InfoContext(r.Context(), "http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", requestID(r),
		)
	})
}

func (a *API) authenticate(r *http.Request) (store.User, error) {
	c, err := r.Cookie(auth.CookieName)
	if err != nil || c.Value == "" {
		return store.User{}, errUnauthorized
	}
	u, err := a.store.SessionUser(r.Context(), auth.HashToken(c.Value))
	if errors.Is(err, store.ErrNotFound) {
		return store.User{}, errUnauthorized
	}
	return u, err
}

func (a *API) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := a.authenticate(r)
		if err != nil {
			if errors.Is(err, errUnauthorized) {
				// Clear a stale cookie so the web app's login redirect cannot loop.
				a.clearSessionCookie(w)
			}
			a.writeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

func (a *API) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		Domain:   a.cfg.CookieDomain,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   a.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *API) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		Domain:   a.cfg.CookieDomain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   a.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *API) rateLimitExceeded(w http.ResponseWriter, r *http.Request) {
	a.writeError(w, r, &apiError{
		Status:  http.StatusTooManyRequests,
		Code:    "rate_limited",
		Message: "Too many requests. Please slow down and try again shortly.",
	})
}
