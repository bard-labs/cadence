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
	case "control_request":
		c.handleControlRequest(ctx, m.RoomID)
	case "control_respond":
		c.handleControlRespond(ctx, m.UserID, m.Accept)
	case "control_revoke":
		c.handleControlRevoke(ctx, m.UserID)
	case "control_release":
		c.handleControlRelease(ctx, m.RoomID)
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
		// so listeners pause instead of playing on without a host, and drop
		// shared control because nobody is left to supervise it.
		if st, ok := c.loadOwnState(ctx); ok && !st.Paused {
			now := time.Now().UnixMilli()
			st.PositionMs += int64(float64(now-st.CapturedAt) * st.Rate)
			st.CapturedAt = now
			st.Paused = true
			st.By = c.userID
			c.saveState(ctx, c.userID, st)
		}
		c.clearControllers(ctx, c.userID)
		c.releaseControlling(ctx)
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
	c.dropControl(ctx, room)
	c.hub.publishRoom(ctx, room)
}

func (c *client) handleState(ctx context.Context, m inbound) {
	if _, err := uuid.Parse(m.TrackID); err != nil {
		c.sendError("invalid_state", "Invalid playback state.", "")
		return
	}
	room := c.userID
	if m.RoomID != "" && m.RoomID != c.userID {
		if _, err := uuid.Parse(m.RoomID); err != nil {
			c.sendError("invalid_state", "Invalid playback state.", "")
			return
		}
		member, err := c.hub.rdb.SIsMember(ctx, controllersKey(m.RoomID), c.userID).Result()
		if err != nil || !member {
			c.sendError("not_controller", "You don't have control of this room.", m.RoomID)
			return
		}
		room = m.RoomID
	} else {
		// Publishing your own room means you stopped listening along.
		c.leave(ctx)
	}

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
		By:         c.userID,
	}
	c.saveState(ctx, room, st)
	c.hub.publishRoom(ctx, room)
	c.persist(ctx, room, st)
}

func (c *client) handleStop(ctx context.Context) {
	st, hadState := c.loadOwnState(ctx)
	c.clearControllers(ctx, c.userID)
	pipe := c.hub.rdb.TxPipeline()
	pipe.Del(ctx, stateKey(c.userID))
	pipe.Incr(ctx, seqKey(c.userID))
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Error("stop room", "user", c.userID, "err", err)
	}
	c.hub.publishRoom(ctx, c.userID)
	if hadState {
		st.Paused = true
		c.persist(ctx, c.userID, st)
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

func (c *client) saveState(ctx context.Context, room string, st RoomState) {
	raw, _ := json.Marshal(st)
	pipe := c.hub.rdb.TxPipeline()
	pipe.Set(ctx, stateKey(room), raw, stateTTL)
	pipe.Incr(ctx, seqKey(room))
	pipe.Expire(ctx, seqKey(room), 24*time.Hour)
	pipe.Expire(ctx, listenersKey(room), stateTTL)
	pipe.Expire(ctx, controllersKey(room), stateTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Error("save state", "room", room, "err", err)
	}
}

// persist records "last played" for the room's owner only when the track or
// play/pause changes, not on every heartbeat. A controller updates the host's
// row, because the room is the host's.
func (c *client) persist(ctx context.Context, room string, st RoomState) {
	key := room + ":" + st.TrackID
	if st.Paused {
		key += ":paused"
	}
	if key == c.persistedKey {
		return
	}
	if err := c.hub.store.UpsertListening(ctx, room, st.TrackID, st.PositionMs, st.Paused); err != nil {
		c.hub.log.Warn("persist listening", "room", room, "err", err)
		return
	}
	c.persistedKey = key
}

func (c *client) handleControlRequest(ctx context.Context, room string) {
	if _, err := uuid.Parse(room); err != nil || room == c.userID {
		c.sendError("control_invalid", "You can't request control of your own room.", room)
		return
	}
	if c.listeningTo != room {
		c.sendError("control_invalid", "Listen along first, then ask for control.", room)
		return
	}
	ok, err := c.hub.store.SharesGroup(ctx, c.userID, room)
	if err != nil {
		c.hub.log.Error("control request authz", "user", c.userID, "err", err)
		c.sendError("internal", "Could not request control right now.", room)
		return
	}
	if !ok {
		c.sendError("control_invalid", "You can only take control with people in your groups.", room)
		return
	}
	member, err := c.hub.rdb.SIsMember(ctx, controllersKey(room), c.userID).Result()
	if err != nil {
		c.sendError("internal", "Could not request control right now.", room)
		return
	}
	if member {
		c.sendError("control_invalid", "You already have control.", room)
		return
	}
	n, err := c.hub.rdb.SCard(ctx, controllersKey(room)).Result()
	if err != nil {
		c.sendError("internal", "Could not request control right now.", room)
		return
	}
	if n >= maxControllers {
		c.sendError("control_invalid", "Too many people already have control.", room)
		return
	}
	fresh, err := c.hub.rdb.SetNX(ctx, controlReqKey(room, c.userID), c.username, controlRequestTTL).Result()
	if err != nil {
		c.sendError("internal", "Could not request control right now.", room)
		return
	}
	if !fresh {
		c.sendError("control_pending", "You already asked. Waiting for them to answer.", room)
		return
	}
	c.hub.publishUser(ctx, room, controlRequestMessage{
		Type: "control_request", RoomID: room, From: c.userID, Username: c.username,
	})
}

func (c *client) handleControlRespond(ctx context.Context, userID string, accept bool) {
	if _, err := uuid.Parse(userID); err != nil || userID == c.userID {
		c.sendError("control_invalid", "That control request is not valid.", "")
		return
	}
	exists, err := c.hub.rdb.Exists(ctx, controlReqKey(c.userID, userID)).Result()
	if err != nil {
		c.sendError("internal", "Could not answer that request.", "")
		return
	}
	if exists == 0 {
		c.sendError("control_expired", "That request expired.", "")
		return
	}
	if err := c.hub.rdb.Del(ctx, controlReqKey(c.userID, userID)).Err(); err != nil {
		c.hub.log.Warn("control request delete", "user", userID, "err", err)
	}
	if accept {
		ok, err := c.hub.store.SharesGroup(ctx, c.userID, userID)
		if err != nil || !ok {
			accept = false
		}
	}
	if !accept {
		c.hub.publishUser(ctx, userID, controlResultMessage{Type: "control_result", RoomID: c.userID, Accepted: false})
		return
	}
	n, err := c.hub.rdb.SCard(ctx, controllersKey(c.userID)).Result()
	if err != nil || n >= maxControllers {
		c.hub.publishUser(ctx, userID, controlResultMessage{Type: "control_result", RoomID: c.userID, Accepted: false})
		c.sendError("control_invalid", "Too many people already have control.", "")
		return
	}
	pipe := c.hub.rdb.TxPipeline()
	pipe.SAdd(ctx, controllersKey(c.userID), userID)
	pipe.Expire(ctx, controllersKey(c.userID), stateTTL)
	pipe.SAdd(ctx, controllingKey(userID), c.userID)
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Error("grant control", "user", userID, "err", err)
		c.sendError("internal", "Could not share control.", "")
		return
	}
	c.hub.publishRoom(ctx, c.userID)
	c.hub.publishUser(ctx, userID, controlResultMessage{Type: "control_result", RoomID: c.userID, Accepted: true})
}

func (c *client) handleControlRevoke(ctx context.Context, userID string) {
	if _, err := uuid.Parse(userID); err != nil {
		c.sendError("control_invalid", "That person isn't valid.", "")
		return
	}
	if !c.dropControlOf(ctx, c.userID, userID) {
		return
	}
	c.hub.publishRoom(ctx, c.userID)
	c.hub.publishUser(ctx, userID, controlRevokedMessage{Type: "control_revoked", RoomID: c.userID})
}

func (c *client) handleControlRelease(ctx context.Context, room string) {
	if room == "" {
		room = c.listeningTo
	}
	if _, err := uuid.Parse(room); err != nil || room == c.userID {
		c.sendError("control_invalid", "You aren't controlling that room.", room)
		return
	}
	if !c.dropControl(ctx, room) {
		return
	}
	c.hub.publishRoom(ctx, room)
}

// dropControl removes this user from a room they were allowed to drive.
func (c *client) dropControl(ctx context.Context, room string) bool {
	return c.dropControlOf(ctx, room, c.userID)
}

func (c *client) dropControlOf(ctx context.Context, room, userID string) bool {
	removed, err := c.hub.rdb.SRem(ctx, controllersKey(room), userID).Result()
	if err != nil {
		c.hub.log.Warn("drop control", "room", room, "user", userID, "err", err)
		return false
	}
	if removed == 0 {
		return false
	}
	if err := c.hub.rdb.SRem(ctx, controllingKey(userID), room).Err(); err != nil {
		c.hub.log.Warn("drop controlling index", "room", room, "user", userID, "err", err)
	}
	return true
}

func (c *client) clearControllers(ctx context.Context, room string) {
	ids, err := c.hub.rdb.SMembers(ctx, controllersKey(room)).Result()
	if err != nil {
		c.hub.log.Warn("list controllers", "room", room, "err", err)
		return
	}
	if len(ids) == 0 {
		return
	}
	pipe := c.hub.rdb.TxPipeline()
	pipe.Del(ctx, controllersKey(room))
	for _, id := range ids {
		pipe.SRem(ctx, controllingKey(id), room)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		c.hub.log.Warn("clear controllers", "room", room, "err", err)
		return
	}
	for _, id := range ids {
		c.hub.publishUser(ctx, id, controlRevokedMessage{Type: "control_revoked", RoomID: room})
	}
}

// releaseControlling drops every room this user was allowed to drive.
// Used when their last tab closes.
func (c *client) releaseControlling(ctx context.Context) {
	rooms, err := c.hub.rdb.SMembers(ctx, controllingKey(c.userID)).Result()
	if err != nil {
		c.hub.log.Warn("list controlling", "user", c.userID, "err", err)
		return
	}
	for _, room := range rooms {
		if c.dropControl(ctx, room) {
			c.hub.publishRoom(ctx, room)
		}
	}
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
