package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"
)

type client struct {
	hub       *Hub
	conn      *websocket.Conn
	connID    string
	userID    string
	username  string
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
	limiter   *rate.Limiter
	rooms     map[string]struct{} // guarded by hub.mu

	// Owned by the read loop goroutine.
	listeningTo  string
	lastTrackID  string
	persistedKey string
}

func (c *client) close(code websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		close(c.done)
		go c.conn.Close(code, reason)
	})
}

// enqueue never blocks the hub: a client that cannot keep up is disconnected
// and will resync from a fresh snapshot when it reconnects.
func (c *client) enqueue(msg []byte) {
	select {
	case <-c.done:
	case c.send <- msg:
	default:
		c.close(websocket.StatusPolicyViolation, "client too slow")
	}
}

func (c *client) sendJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.enqueue(data)
}

func (c *client) sendError(code, msg, room string) {
	c.sendJSON(errorMessage{Type: "error", Code: code, Message: msg, RoomID: room})
}

func (c *client) writeLoop(ctx context.Context) {
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				c.close(websocket.StatusGoingAway, "write failed")
				return
			}
		}
	}
}

func (c *client) readLoop(ctx context.Context) {
	for {
		rctx, cancel := context.WithTimeout(ctx, readTimeout)
		typ, data, err := c.conn.Read(rctx)
		cancel()
		if err != nil {
			return
		}
		if !c.limiter.Allow() {
			c.close(websocket.StatusPolicyViolation, "rate limited")
			return
		}
		if typ != websocket.MessageText {
			c.sendError("bad_message", "Only text messages are supported.", "")
			continue
		}
		var m inbound
		if err := json.Unmarshal(data, &m); err != nil {
			c.sendError("bad_message", "Message is not valid JSON.", "")
			continue
		}
		messagesTotal.WithLabelValues(metricType(m.Type)).Inc()
		c.handle(ctx, m)
	}
}

func (c *client) handle(ctx context.Context, m inbound) {
	switch m.Type {
	case "ping":
		c.sendJSON(pongMessage{Type: "pong", T0: m.T0, TS: time.Now().UnixMilli()})
		c.touchPresence(ctx)
	case "watch":
		c.handleWatch(ctx, m.RoomIDs)
	case "listen":
		c.handleListen(ctx, m.RoomID)
	case "leave":
		c.leave(ctx)
	case "state":
		c.handleState(ctx, m)
	case "stop":
		c.handleStop(ctx)
	case "drift":
		driftHistogram.Observe(math.Min(math.Abs(m.DriftMs), 60_000))
	default:
		c.sendError("unknown_type", "Unknown message type.", "")
	}
}

func (c *client) touchPresence(ctx context.Context) {
	pipe := c.hub.rdb.TxPipeline()
	pipe.HSet(ctx, presenceKey(c.userID), c.connID, time.Now().Unix())
	pipe.Expire(ctx, presenceKey(c.userID), presenceTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Warn("presence refresh", "user", c.userID, "err", err)
	}
}

func (c *client) onConnect(ctx context.Context) {
	c.touchPresence(ctx)
	c.hub.publishRoom(ctx, c.userID)
}

func (c *client) onDisconnect() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c.leave(ctx)

	rdb := c.hub.rdb
	if err := rdb.HDel(ctx, presenceKey(c.userID), c.connID).Err(); err != nil {
		c.hub.log.Warn("presence remove", "user", c.userID, "err", err)
	}
	remaining, _ := rdb.HLen(ctx, presenceKey(c.userID)).Result()
	if remaining == 0 {
		// The host's last tab closed: freeze the room at the current position
		// so listeners pause instead of playing on without a host.
		if st, ok := c.loadOwnState(ctx); ok && !st.Paused {
			now := time.Now().UnixMilli()
			st.PositionMs += int64(float64(now-st.CapturedAt) * st.Rate)
			st.CapturedAt = now
			st.Paused = true
			c.saveState(ctx, st)
		}
	}
	c.hub.publishRoom(ctx, c.userID)
}

func (c *client) handleWatch(ctx context.Context, ids []string) {
	if len(ids) > maxWatch {
		ids = ids[:maxWatch]
	}
	friends, err := c.hub.store.CoMemberIDs(ctx, c.userID)
	if err != nil {
		c.hub.log.Error("watch friends", "user", c.userID, "err", err)
		c.sendError("internal", "Could not load your friends. Retrying soon.", "")
		return
	}
	want := map[string]struct{}{c.userID: {}}
	for _, id := range ids {
		if _, ok := friends[id]; ok {
			want[id] = struct{}{}
		}
	}
	if c.listeningTo != "" {
		if _, ok := friends[c.listeningTo]; ok {
			want[c.listeningTo] = struct{}{}
		} else {
			room := c.listeningTo
			c.leave(ctx)
			c.sendError("listen_ended", "You are no longer in a group with this person.", room)
		}
	}
	c.hub.setSubscriptions(c, want)

	rooms := make([]string, 0, len(want))
	for id := range want {
		rooms = append(rooms, id)
	}
	snaps, err := c.hub.Snapshots(ctx, rooms)
	if err != nil {
		c.sendError("internal", "Could not load live rooms. Retrying soon.", "")
		return
	}
	for id, s := range snaps {
		c.sendJSON(roomMessage{Type: "room", RoomID: id, Snapshot: s})
	}
}

func (c *client) handleListen(ctx context.Context, room string) {
	if _, err := uuid.Parse(room); err != nil || room == c.userID {
		c.sendError("listen_invalid", "You can't listen along to yourself.", room)
		return
	}
	ok, err := c.hub.store.SharesGroup(ctx, c.userID, room)
	if err != nil {
		c.hub.log.Error("listen authz", "user", c.userID, "err", err)
		c.sendError("internal", "Could not join right now. Please try again.", room)
		return
	}
	if !ok {
		c.sendError("listen_forbidden", "You can only listen along with people in your groups.", room)
		return
	}
	if c.listeningTo != "" && c.listeningTo != room {
		c.leave(ctx)
	}
	if _, hosting := c.loadOwnState(ctx); hosting {
		c.handleStop(ctx)
	}

	c.listeningTo = room
	c.hub.subscribe(c, room)
	pipe := c.hub.rdb.TxPipeline()
	pipe.SAdd(ctx, listenersKey(room), c.userID)
	pipe.Expire(ctx, listenersKey(room), stateTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Error("listen add", "room", room, "err", err)
	}
	c.sendJSON(listeningMessage{Type: "listening", RoomID: room})
	c.hub.publishRoom(ctx, room)
}

func (c *client) leave(ctx context.Context) {
	if c.listeningTo == "" {
		return
	}
	room := c.listeningTo
	c.listeningTo = ""
	if err := c.hub.rdb.SRem(ctx, listenersKey(room), c.userID).Err(); err != nil {
		c.hub.log.Warn("listen remove", "room", room, "err", err)
	}
	c.hub.publishRoom(ctx, room)
}

func (c *client) handleState(ctx context.Context, m inbound) {
	if _, err := uuid.Parse(m.TrackID); err != nil {
		c.sendError("invalid_state", "Invalid playback state.", "")
		return
	}
	c.leave(ctx)

	if m.TrackID != c.lastTrackID {
		t, err := c.hub.store.TrackByID(ctx, m.TrackID)
		if err != nil || t.Status != "ready" {
			c.sendError("track_unavailable", "That track isn't available.", "")
			return
		}
		c.lastTrackID = m.TrackID
	}

	now := time.Now().UnixMilli()
	captured := int64(m.CapturedAt)
	if captured <= 0 || abs64(captured-now) > maxClockSkewMs {
		captured = now
	}
	r := m.Rate
	if r < 0.5 || r > 2 {
		r = 1
	}
	st := RoomState{
		TrackID:    m.TrackID,
		PositionMs: clamp64(int64(m.PositionMs), 0, maxPositionMs),
		CapturedAt: captured,
		Paused:     m.Paused,
		Rate:       r,
	}
	c.saveState(ctx, st)
	c.hub.publishRoom(ctx, c.userID)
	c.persist(ctx, st)
}

func (c *client) handleStop(ctx context.Context) {
	st, hadState := c.loadOwnState(ctx)
	pipe := c.hub.rdb.TxPipeline()
	pipe.Del(ctx, stateKey(c.userID))
	pipe.Incr(ctx, seqKey(c.userID))
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Error("stop room", "user", c.userID, "err", err)
	}
	c.hub.publishRoom(ctx, c.userID)
	if hadState {
		st.Paused = true
		c.persist(ctx, st)
	}
}

func (c *client) loadOwnState(ctx context.Context) (RoomState, bool) {
	raw, err := c.hub.rdb.Get(ctx, stateKey(c.userID)).Bytes()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			c.hub.log.Warn("load state", "user", c.userID, "err", err)
		}
		return RoomState{}, false
	}
	var st RoomState
	if err := json.Unmarshal(raw, &st); err != nil {
		return RoomState{}, false
	}
	return st, true
}

func (c *client) saveState(ctx context.Context, st RoomState) {
	raw, _ := json.Marshal(st)
	pipe := c.hub.rdb.TxPipeline()
	pipe.Set(ctx, stateKey(c.userID), raw, stateTTL)
	pipe.Incr(ctx, seqKey(c.userID))
	pipe.Expire(ctx, seqKey(c.userID), 24*time.Hour)
	pipe.Expire(ctx, listenersKey(c.userID), stateTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Error("save state", "user", c.userID, "err", err)
	}
}

// persist records "last played" in Postgres only when the track or play/pause
// changes, not on every heartbeat.
func (c *client) persist(ctx context.Context, st RoomState) {
	key := st.TrackID
	if st.Paused {
		key += ":paused"
	}
	if key == c.persistedKey {
		return
	}
	if err := c.hub.store.UpsertListening(ctx, c.userID, st.TrackID, st.PositionMs, st.Paused); err != nil {
		c.hub.log.Warn("persist listening", "user", c.userID, "err", err)
		return
	}
	c.persistedKey = key
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func clamp64(v, lo, hi int64) int64 {
	return max(lo, min(v, hi))
}
