package httpapi

import (
	"bufio"
	"context"
	"errors"
	"net"
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

// requestTimeout cancels the request context after d. Unlike chi's Timeout
// middleware, it never calls WriteHeader once the handler has written a
// response or hijacked the connection. chi's version does that from a defer,
// which logs "response.WriteHeader on hijacked connection" for any WebSocket
// that outlives the deadline.
func requestTimeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			rec := &guardWriter{ResponseWriter: w}
			next.ServeHTTP(rec, r.WithContext(ctx))
			if ctx.Err() == context.DeadlineExceeded && !rec.wrote && !rec.hijacked {
				writeJSON(w, http.StatusGatewayTimeout, map[string]any{
					"error": map[string]string{"code": "timeout", "message": "The request took too long."},
				})
			}
		})
	}
}

// guardWriter records whether the handler already responded or took over the
// connection, and forwards the optional interfaces net/http looks up.
type guardWriter struct {
	http.ResponseWriter
	wrote    bool
	hijacked bool
}

func (g *guardWriter) WriteHeader(code int) {
	g.wrote = true
	g.ResponseWriter.WriteHeader(code)
}

func (g *guardWriter) Write(b []byte) (int, error) {
	g.wrote = true
	return g.ResponseWriter.Write(b)
}

func (g *guardWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := g.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	g.hijacked = true
	return h.Hijack()
}

func (g *guardWriter) Flush() {
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *guardWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }

func (a *API) rateLimitExceeded(w http.ResponseWriter, r *http.Request) {
	a.writeError(w, r, &apiError{
		Status:  http.StatusTooManyRequests,
		Code:    "rate_limited",
		Message: "Too many requests. Please slow down and try again shortly.",
	})
}
