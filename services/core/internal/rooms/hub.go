package rooms

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
)

const redisChannel = "cadence:rooms"

type PlaybackState struct {
	HostUserID string `json:"hostUserId"`
	TrackID    string `json:"trackId"`
	PositionMs int64  `json:"positionMs"`
	ServerTs   int64  `json:"serverTs"`
	Paused     bool   `json:"paused"`
	Rate       float64 `json:"rate"`
	Seq        int64  `json:"seq"`
}

type Hub struct {
	rdb    *redis.Client
	log    *slog.Logger
	local  map[string]map[*websocket.Conn]struct{}
	mu     sync.RWMutex
	pubsub *redis.PubSub
}

func NewHub(rdb *redis.Client, log *slog.Logger) *Hub {
	return &Hub{
		rdb:   rdb,
		log:   log,
		local: make(map[string]map[*websocket.Conn]struct{}),
	}
}

func (h *Hub) Start(ctx context.Context) {
	h.pubsub = h.rdb.Subscribe(ctx, redisChannel)
	go h.listenRedis(ctx)
}

func (h *Hub) listenRedis(ctx context.Context) {
	ch := h.pubsub.Channel()
	for msg := range ch {
		var envelope struct {
			RoomID  string          `json:"roomId"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal([]byte(msg.Payload), &envelope); err != nil {
			continue
		}
		h.broadcastLocal(envelope.RoomID, envelope.Payload)
	}
}

func (h *Hub) Register(roomID string, c *websocket.Conn) {
	h.mu.Lock()
	if h.local[roomID] == nil {
		h.local[roomID] = make(map[*websocket.Conn]struct{})
	}
	h.local[roomID][c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) Unregister(roomID string, c *websocket.Conn) {
	h.mu.Lock()
	if m := h.local[roomID]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.local, roomID)
		}
	}
	h.mu.Unlock()
}

func (h *Hub) broadcastLocal(roomID string, payload []byte) {
	h.mu.RLock()
	conns := h.local[roomID]
	h.mu.RUnlock()
	for c := range conns {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = c.Write(ctx, websocket.MessageText, payload)
		cancel()
	}
}

func (h *Hub) Publish(ctx context.Context, roomID string, payload []byte) error {
	envelope, _ := json.Marshal(map[string]interface{}{
		"roomId":  roomID,
		"payload": json.RawMessage(payload),
	})
	return h.rdb.Publish(ctx, redisChannel, envelope).Err()
}

func (h *Hub) SetState(ctx context.Context, state PlaybackState) error {
	key := "room:" + state.HostUserID + ":state"
	raw, _ := json.Marshal(state)
	if err := h.rdb.Set(ctx, key, raw, 30*time.Minute).Err(); err != nil {
		return err
	}
	return h.Publish(ctx, state.HostUserID, raw)
}

func (h *Hub) GetState(ctx context.Context, hostUserID string) (*PlaybackState, error) {
	key := "room:" + hostUserID + ":state"
	raw, err := h.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var st PlaybackState
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

func (h *Hub) SetPresence(ctx context.Context, userID string, username string) error {
	key := "presence:" + userID
	val, _ := json.Marshal(map[string]string{"userId": userID, "username": username})
	return h.rdb.Set(ctx, key, val, 2*time.Minute).Err()
}
