package realtime

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	connectionsGauge = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "cadence_ws_connections",
		Help: "Open WebSocket connections on this instance.",
	})
	messagesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cadence_ws_messages_total",
		Help: "Inbound WebSocket messages by type.",
	}, []string{"type"})
	driftHistogram = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "cadence_sync_drift_ms",
		Help:    "Absolute listener playback drift reported by clients, in milliseconds.",
		Buckets: []float64{5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560},
	})
)

var knownTypes = map[string]bool{
	"ping": true, "watch": true, "listen": true, "leave": true,
	"state": true, "stop": true, "drift": true,
}

func metricType(t string) string {
	if knownTypes[t] {
		return t
	}
	return "unknown"
}
