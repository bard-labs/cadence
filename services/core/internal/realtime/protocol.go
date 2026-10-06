package realtime

import (
	"encoding/json"
	"time"
)

// Wire protocol. Mirrors packages/protocol/src/index.ts; keep both in sync.

const (
	eventsChannel     = "cadence:events"
	stateTTL          = time.Hour
	presenceTTL       = 90 * time.Second
	readTimeout       = 60 * time.Second
	writeTimeout      = 10 * time.Second
	sendBuffer        = 64
	maxMessageBytes   = 4096
	maxConnsPerUser   = 5
	maxWatch          = 200
	maxPositionMs     = 6 * 60 * 60 * 1000
	maxClockSkewMs    = 5000
	maxControllers    = 8
	controlRequestTTL = 2 * time.Minute
)

func stateKey(id string) string       { return "cadence:room:" + id + ":state" }
func seqKey(id string) string         { return "cadence:room:" + id + ":seq" }
func listenersKey(id string) string   { return "cadence:room:" + id + ":listeners" }
func controllersKey(id string) string { return "cadence:room:" + id + ":controllers" }
func controlReqKey(room, user string) string {
	return "cadence:room:" + room + ":creq:" + user
}
func controllingKey(user string) string { return "cadence:user:" + user + ":controlling" }
func presenceKey(id string) string      { return "cadence:presence:" + id }

// RoomState is the host's playback at CapturedAt (server clock, ms). Listeners
// extrapolate: position = PositionMs + (serverNow - CapturedAt) * Rate.
type RoomState struct {
	TrackID    string  `json:"trackId"`
	PositionMs int64   `json:"positionMs"`
	CapturedAt int64   `json:"capturedAt"`
	Paused     bool    `json:"paused"`
	Rate       float64 `json:"rate"`
	// By is the user who last published this state. Empty on older snapshots.
	By string `json:"by,omitempty"`
}

// Snapshot is everything a client needs to render one person's room. Seq only
// grows, so clients can discard snapshots that arrive out of order.
type Snapshot struct {
	Seq         int64      `json:"seq"`
	State       *RoomState `json:"state"`
	Listeners   int64      `json:"listeners"`
	Online      bool       `json:"online"`
	Controllers []string   `json:"controllers"`
}

type inbound struct {
	Type       string   `json:"type"`
	T0         float64  `json:"t0"`
	RoomID     string   `json:"roomId"`
	RoomIDs    []string `json:"roomIds"`
	TrackID    string   `json:"trackId"`
	PositionMs float64  `json:"positionMs"`
	Paused     bool     `json:"paused"`
	Rate       float64  `json:"rate"`
	CapturedAt float64  `json:"capturedAt"`
	DriftMs    float64  `json:"driftMs"`
	UserID     string   `json:"userId"`
	Accept     bool     `json:"accept"`
}

type roomMessage struct {
	Type   string `json:"type"`
	RoomID string `json:"roomId"`
	Snapshot
}

type pongMessage struct {
	Type string  `json:"type"`
	T0   float64 `json:"t0"`
	TS   int64   `json:"ts"`
}

type listeningMessage struct {
	Type   string `json:"type"`
	RoomID string `json:"roomId"`
}

type errorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
	RoomID  string `json:"roomId,omitempty"`
}

type controlRequestMessage struct {
	Type     string `json:"type"`
	RoomID   string `json:"roomId"`
	From     string `json:"from"`
	Username string `json:"username"`
}

type controlResultMessage struct {
	Type     string `json:"type"`
	RoomID   string `json:"roomId"`
	Accepted bool   `json:"accepted"`
}

type controlRevokedMessage struct {
	Type   string `json:"type"`
	RoomID string `json:"roomId"`
}

// envelope is the Redis pub/sub payload. Room broadcasts to everyone watching
// that room. User delivers only to that user's own connections, on every API
// instance, which is how a control request reaches the host without a refresh
// and without telling the whole room.
type envelope struct {
	Room string          `json:"room,omitempty"`
	User string          `json:"user,omitempty"`
	Data json.RawMessage `json:"data"`
}
