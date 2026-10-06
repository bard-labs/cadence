package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/config"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/realtime"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

type API struct {
	cfg   config.Config
	log   *slog.Logger
	store *store.Store
	s3    *storage.S3
	rdb   *redis.Client
	hub   *realtime.Hub
}

func New(cfg config.Config, log *slog.Logger, st *store.Store, s3 *storage.S3, rdb *redis.Client, hub *realtime.Hub) *API {
	return &API{cfg: cfg, log: log, store: st, s3: s3, rdb: rdb, hub: hub}
}

func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	if a.cfg.TrustProxy {
		// Only trust X-Forwarded-For behind a proxy we control, otherwise clients
		// could spoof their IP to dodge rate limits.
		r.Use(middleware.RealIP)
	}
	r.Use(a.requestLogger, middleware.Recoverer, securityHeaders)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{a.cfg.AllowedOrigin},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           600,
	}))
	r.Use(a.sameOrigin)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/readyz", a.ready)
	r.Handle("/metrics", promhttp.Handler())

	r.Get("/ws", a.websocket)

	r.Route("/v1", func(v chi.Router) {
		v.Use(requestTimeout(15 * time.Second))
		v.Use(httprate.Limit(300, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP), httprate.WithLimitHandler(a.rateLimitExceeded)))

		authLimit := httprate.Limit(20, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP), httprate.WithLimitHandler(a.rateLimitExceeded))
		v.With(authLimit).Post("/auth/register", a.register)
		v.With(authLimit).Post("/auth/login", a.login)
		v.Post("/auth/logout", a.logout)

		v.Group(func(p chi.Router) {
			p.Use(a.requireSession)
			p.Get("/me", a.me)
			p.Get("/friends", a.friends)

			p.Get("/groups", a.listGroups)
			p.Post("/groups", a.createGroup)
			p.Get("/groups/{groupID}", a.getGroup)
			p.Delete("/groups/{groupID}", a.deleteGroup)
			p.Post("/groups/{groupID}/leave", a.leaveGroup)
			p.Post("/groups/{groupID}/invites", a.createInvite)

			p.Get("/invites", a.pendingInvites)
			p.Post("/invites/{inviteID}/accept", a.acceptInvite)
			p.Post("/invites/{inviteID}/decline", a.declineInvite)

			p.With(httprate.Limit(30, time.Hour, httprate.WithKeyFuncs(userKeyFunc), httprate.WithLimitHandler(a.rateLimitExceeded))).
				Post("/uploads", a.createUpload)
			p.Post("/tracks", a.createTrack)
			p.Get("/tracks", a.listTracks)
			p.Get("/tracks/{trackID}", a.getTrack)
		})
	})

	r.NotFound(func(w http.ResponseWriter, r *http.Request) { a.writeError(w, r, errNotFound) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		a.writeError(w, r, &apiError{Status: http.StatusMethodNotAllowed, Code: "method_not_allowed", Message: "Method not allowed."})
	})
	return r
}

func userKeyFunc(r *http.Request) (string, error) {
	return currentUser(r).ID, nil
}

func (a *API) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	checks := map[string]string{"postgres": "ok", "redis": "ok", "storage": "ok"}
	status := http.StatusOK
	if err := a.store.Ping(ctx); err != nil {
		checks["postgres"], status = "down", http.StatusServiceUnavailable
	}
	if err := a.rdb.Ping(ctx).Err(); err != nil {
		checks["redis"], status = "down", http.StatusServiceUnavailable
	}
	if err := a.s3.Ping(ctx); err != nil {
		checks["storage"], status = "down", http.StatusServiceUnavailable
	}
	writeJSON(w, status, checks)
}
