package httpapi

import (
	"net/http"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/realtime"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

type friendView struct {
	store.Friend
	Live realtime.Snapshot `json:"live"`
}

// friends returns everyone you share a group with plus their live room, so the
// listen view can render instantly before the WebSocket catches up.
func (a *API) friends(w http.ResponseWriter, r *http.Request) {
	friends, err := a.store.Friends(r.Context(), currentUser(r).ID)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	ids := make([]string, len(friends))
	for i, f := range friends {
		ids[i] = f.UserID
	}
	snaps, err := a.hub.Snapshots(r.Context(), ids)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	out := make([]friendView, len(friends))
	for i, f := range friends {
		out[i] = friendView{Friend: f, Live: snaps[f.UserID]}
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) websocket(w http.ResponseWriter, r *http.Request) {
	u, err := a.authenticate(r)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	a.hub.Serve(w, r, u)
}
