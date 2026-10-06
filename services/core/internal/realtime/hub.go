package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

// Hub fans room events out to local WebSocket clients. Every event goes
// through Redis pub/sub, so any number of API instances can serve one room.
type Hub struct {
	rdb     *redis.Client
	store   *store.Store
	log     *slog.Logger
	origins []string

	mu      sync.RWMutex
	rooms   map[string]map[*client]struct{}
	clients map[*client]struct{}
	perUser map[string]int
	closing bool
}

func NewHub(rdb *redis.Client, st *store.Store, log *slog.Logger, allowedOrigin string) *Hub {
	return &Hub{
		rdb:     rdb,
		store:   st,
		log:     log,
		origins: []string{allowedOrigin},
		rooms:   make(map[string]map[*client]struct{}),
		clients: make(map[*client]struct{}),
		perUser: make(map[string]int),
	}
}

// Start subscribes to the events channel and blocks until the subscription is
// confirmed, so no event published after Start returns can be missed.
func (h *Hub) Start(ctx context.Context) error {
	sub := h.rdb.Subscribe(ctx, eventsChannel)
	if _, err := sub.Receive(ctx); err != nil {
		_ = sub.Close()
		return err
	}
	go func() {
		defer sub.Close()
		ch := sub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var env envelope
				if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
					h.log.Warn("bad event envelope", "err", err)
					continue
				}
				h.deliver(env.Room, env.Data)
			}
		}
	}()
	return nil
}

func (h *Hub) Shutdown() {
	h.mu.Lock()
	h.closing = true
	clients := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()
	for _, c := range clients {
		c.close(websocket.StatusGoingAway, "server restarting")
	}
}

func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, u store.User) {
	h.mu.Lock()
	switch {
	case h.closing:
		h.mu.Unlock()
		rejectHTTP(w, http.StatusServiceUnavailable, "unavailable", "Server is restarting. Reconnecting shortly.")
		return
	case h.perUser[u.ID] >= maxConnsPerUser:
		h.mu.Unlock()
		rejectHTTP(w, http.StatusTooManyRequests, "too_many_connections", "Too many open tabs. Close one and try again.")
		return
	}
	h.perUser[u.ID]++
	h.mu.Unlock()

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		h.release(u.ID)
		return
	}
	conn.SetReadLimit(maxMessageBytes)

	c := &client{
		hub:      h,
		conn:     conn,
		connID:   uuid.NewString(),
		userID:   u.ID,
		username: u.Username,
		send:     make(chan []byte, sendBuffer),
		done:     make(chan struct{}),
		rooms:    make(map[string]struct{}),
		limiter:  rate.NewLimiter(20, 40),
	}

	// The request context must not be used after Accept hijacks the connection.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	h.register(c)
	connectionsGauge.Inc()
	go c.writeLoop(ctx)
	c.onConnect(ctx)
	c.readLoop(ctx)
	c.close(websocket.StatusNormalClosure, "")
	h.unregister(c)
	c.onDisconnect()
	connectionsGauge.Dec()
}

func rejectHTTP(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func (h *Hub) release(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.perUser[userID]--; h.perUser[userID] <= 0 {
		delete(h.perUser, userID)
	}
}

func (h *Hub) register(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	h.setSubscriptions(c, map[string]struct{}{c.userID: {}})
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	for room := range c.rooms {
		h.removeLocked(c, room)
	}
	h.mu.Unlock()
	h.release(c.userID)
}

func (h *Hub) setSubscriptions(c *client, want map[string]struct{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for room := range c.rooms {
		if _, keep := want[room]; !keep {
			h.removeLocked(c, room)
		}
	}
	for room := range want {
		if _, has := c.rooms[room]; has {
			continue
		}
		if h.rooms[room] == nil {
			h.rooms[room] = make(map[*client]struct{})
		}
		h.rooms[room][c] = struct{}{}
		c.rooms[room] = struct{}{}
	}
}

func (h *Hub) subscribe(c *client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[room] == nil {
		h.rooms[room] = make(map[*client]struct{})
	}
	h.rooms[room][c] = struct{}{}
	c.rooms[room] = struct{}{}
}

func (h *Hub) removeLocked(c *client, room string) {
	delete(c.rooms, room)
	if subs := h.rooms[room]; subs != nil {
		delete(subs, c)
		if len(subs) == 0 {
			delete(h.rooms, room)
		}
	}
}

func (h *Hub) deliver(room string, data []byte) {
	h.mu.RLock()
	targets := make([]*client, 0, len(h.rooms[room]))
	for c := range h.rooms[room] {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.enqueue(data)
	}
}

func (h *Hub) publishRoom(ctx context.Context, room string) {
	snaps, err := h.Snapshots(ctx, []string{room})
	if err != nil {
		h.log.Error("room snapshot", "room", room, "err", err)
		return
	}
	data, _ := json.Marshal(roomMessage{Type: "room", RoomID: room, Snapshot: snaps[room]})
	env, _ := json.Marshal(envelope{Room: room, Data: data})
	if err := h.rdb.Publish(ctx, eventsChannel, env).Err(); err != nil {
		h.log.Error("publish room", "room", room, "err", err)
	}
}

// Snapshots reads the live state of many rooms in one Redis round trip.
func (h *Hub) Snapshots(ctx context.Context, rooms []string) (map[string]Snapshot, error) {
	type cmds struct {
		state     *redis.StringCmd
		seq       *redis.StringCmd
		listeners *redis.IntCmd
		online    *redis.IntCmd
	}
	out := make(map[string]Snapshot, len(rooms))
	if len(rooms) == 0 {
		return out, nil
	}
	pipe := h.rdb.Pipeline()
	all := make([]cmds, len(rooms))
	for i, room := range rooms {
		all[i] = cmds{
			state:     pipe.Get(ctx, stateKey(room)),
			seq:       pipe.Get(ctx, seqKey(room)),
			listeners: pipe.SCard(ctx, listenersKey(room)),
			online:    pipe.Exists(ctx, presenceKey(room)),
		}
	}
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	for i, room := range rooms {
		var s Snapshot
		if raw, err := all[i].state.Bytes(); err == nil {
			var st RoomState
			if json.Unmarshal(raw, &st) == nil {
				s.State = &st
			}
		}
		s.Seq, _ = all[i].seq.Int64()
		s.Listeners = all[i].listeners.Val()
		s.Online = all[i].online.Val() > 0
		out[room] = s
	}
	return out, nil
}
