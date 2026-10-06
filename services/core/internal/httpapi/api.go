package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/auth"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/config"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/rooms"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/storage"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var driftHistogram = promauto.NewHistogram(prometheus.HistogramOpts{
	Name:    "cadence_sync_drift_ms",
	Help:    "Reported client playback drift in milliseconds",
	Buckets: prometheus.LinearBuckets(-500, 50, 21),
})

type API struct {
	cfg    config.Config
	log    *slog.Logger
	store  *store.Store
	s3     *storage.S3
	hub    *rooms.Hub
}

func New(cfg config.Config, log *slog.Logger, st *store.Store, s3 *storage.S3, hub *rooms.Hub) *API {
	return &API{cfg: cfg, log: log, store: st, s3: s3, hub: hub}
}

func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(60*time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{a.cfg.CORSOrigin},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	r.Handle("/metrics", promhttp.Handler())

	r.Route("/v1", func(v chi.Router) {
		v.Post("/auth/guest", a.guestAuth)
		v.Group(func(pr chi.Router) {
			pr.Use(a.requireSession)
			pr.Get("/me", a.me)
			pr.Get("/groups", a.listGroups)
			pr.Post("/groups", a.createGroup)
			pr.Get("/groups/{groupID}", a.getGroup)
			pr.Post("/groups/{groupID}/invites", a.createInvite)
			pr.Get("/invites/pending", a.pendingInvites)
			pr.Post("/invites/{inviteID}/accept", a.acceptInvite)
			pr.Post("/tracks/upload-url", a.uploadURL)
			pr.Post("/tracks", a.createTrack)
			pr.Get("/tracks", a.listTracks)
			pr.Get("/tracks/{trackID}", a.getTrack)
			pr.Post("/listening", a.updateListening)
		})
	})

	r.Get("/ws", a.websocket)

	return r
}

func (a *API) guestAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Username) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username required"})
		return
	}
	username := strings.TrimSpace(body.Username)
	if len(username) < 3 || len(username) > 32 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username must be 3-32 chars"})
		return
	}

	u, err := a.store.CreateUser(r.Context(), username)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			u, err = a.store.UserByUsername(r.Context(), username)
			if err != nil {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "username taken"})
				return
			}
		} else {
			a.log.Error("create user", "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
			return
		}
	}

	token, err := auth.Sign(a.cfg.SessionSecret, auth.NewSession(u.ID, u.Username, 30*24*time.Hour))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName(),
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
	})
	writeJSON(w, http.StatusOK, u)
}

func (a *API) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(auth.CookieName())
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		sess, err := auth.Verify(a.cfg.SessionSecret, c.Value)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		ctx := withSession(r.Context(), sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	u, err := a.store.UserByID(r.Context(), s.UserID)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (a *API) createGroup(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}
	g, err := a.store.CreateGroup(r.Context(), strings.TrimSpace(body.Name), s.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (a *API) listGroups(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	groups, err := a.store.ListGroupsForUser(r.Context(), s.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

func (a *API) getGroup(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	groupID := chi.URLParam(r, "groupID")
	ok, err := a.store.IsGroupMember(r.Context(), groupID, s.UserID)
	if err != nil || !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	members, err := a.store.GroupMembers(r.Context(), groupID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	listening, _ := a.store.ListeningForUsers(r.Context(), ids)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"members":   members,
		"listening": listening,
	})
}

func (a *API) createInvite(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	groupID := chi.URLParam(r, "groupID")
	ok, _ := a.store.IsGroupMember(r.Context(), groupID, s.UserID)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	var body struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username required"})
		return
	}
	_, err := a.store.UserByUsername(r.Context(), strings.TrimSpace(body.Username))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	inv, err := a.store.CreateInvite(r.Context(), groupID, s.UserID, strings.TrimSpace(body.Username))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (a *API) pendingInvites(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	invites, err := a.store.PendingInvitesForUsername(r.Context(), s.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

func (a *API) acceptInvite(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	inviteID := chi.URLParam(r, "inviteID")
	if err := a.store.AcceptInvite(r.Context(), inviteID, s.UserID, s.Username); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
}

func (a *API) uploadURL(w http.ResponseWriter, r *http.Request) {
	key, url, err := a.s3.PresignedUpload(r.Context(), "audio/mpeg")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"objectKey": key, "uploadUrl": url})
}

func (a *API) createTrack(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	var body struct {
		Title     string `json:"title"`
		ObjectKey string `json:"objectKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	t, err := a.store.CreateTrack(r.Context(), s.UserID, strings.TrimSpace(body.Title), body.ObjectKey)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (a *API) listTracks(w http.ResponseWriter, r *http.Request) {
	tracks, err := a.store.ListTracks(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	for i := range tracks {
		if tracks[i].ManifestURL != "" && !strings.HasPrefix(tracks[i].ManifestURL, "http") {
			tracks[i].ManifestURL = a.s3.PublicURL(tracks[i].ManifestURL)
		}
	}
	writeJSON(w, http.StatusOK, tracks)
}

func (a *API) getTrack(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "trackID")
	t, err := a.store.TrackByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if t.ManifestURL != "" && !strings.HasPrefix(t.ManifestURL, "http") {
		t.ManifestURL = a.s3.PublicURL(t.ManifestURL)
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) updateListening(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r.Context())
	var body struct {
		TrackID    string `json:"trackId"`
		PositionMs int    `json:"positionMs"`
		Paused     bool   `json:"paused"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if err := a.store.UpsertListening(r.Context(), s.UserID, body.TrackID, body.PositionMs, body.Paused); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	_ = a.hub.SetPresence(r.Context(), s.UserID, s.Username)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) websocket(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(auth.CookieName())
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	sess, err := auth.Verify(a.cfg.SessionSecret, c.Value)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{a.cfg.CORSOrigin},
	})
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusInternalError, "closed")

	roomID := sess.UserID
	a.hub.Register(roomID, conn)
	defer a.hub.Unregister(roomID, conn)
	_ = a.hub.SetPresence(r.Context(), sess.UserID, sess.Username)

	ctx := r.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		switch msg["type"] {
		case "ping":
			t0, _ := msg["t0"].(float64)
			resp, _ := json.Marshal(map[string]interface{}{
				"type": "pong",
				"t0":   t0,
				"ts":   time.Now().UnixMilli(),
			})
			_ = conn.Write(ctx, websocket.MessageText, resp)
		case "state":
			a.handleHostState(ctx, sess.UserID, msg)
		case "join":
			hostID, _ := msg["hostUserId"].(string)
			if hostID == "" {
				continue
			}
			a.hub.Register(hostID, conn)
			st, _ := a.hub.GetState(ctx, hostID)
			if st != nil {
				raw, _ := json.Marshal(st)
				_ = conn.Write(ctx, websocket.MessageText, raw)
			}
		case "drift":
			if v, ok := msg["driftMs"].(float64); ok {
				driftHistogram.Observe(v)
			}
		}
	}
}

func (a *API) handleHostState(ctx context.Context, hostID string, msg map[string]interface{}) {
	st := rooms.PlaybackState{
		HostUserID: hostID,
		TrackID:    str(msg["trackId"]),
		PositionMs: int64(num(msg["positionMs"])),
		ServerTs:   time.Now().UnixMilli(),
		Paused:     boolVal(msg["paused"]),
		Rate:       num(msg["rate"]),
		Seq:        int64(num(msg["seq"])),
	}
	if st.Rate == 0 {
		st.Rate = 1
	}
	_ = a.hub.SetState(ctx, st)
	_ = a.store.UpsertListening(ctx, hostID, st.TrackID, int(st.PositionMs), st.Paused)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func str(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func num(v interface{}) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}

func boolVal(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}
