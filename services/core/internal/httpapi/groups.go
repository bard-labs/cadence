package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/auth"
	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/store"
)

var errGroupNotFound = &apiError{Status: http.StatusNotFound, Code: "group_not_found", Message: "This group doesn't exist or you're not a member."}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func (a *API) listGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := a.store.ListGroupsForUser(r.Context(), currentUser(r).ID)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, nonNil(groups))
}

func (a *API) createGroup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.writeError(w, r, err)
		return
	}
	name, err := validateText("name", body.Name, 1, 40)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	g, err := a.store.CreateGroup(r.Context(), name, currentUser(r).ID)
	if errors.Is(err, store.ErrGroupLimit) {
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "group_limit", Message: "You've reached the limit of groups you can own."})
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (a *API) getGroup(w http.ResponseWriter, r *http.Request) {
	groupID := chi.URLParam(r, "groupID")
	g, err := a.store.GroupForMember(r.Context(), groupID, currentUser(r).ID)
	if errors.Is(err, store.ErrNotFound) {
		a.writeError(w, r, errGroupNotFound)
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	members, err := a.store.GroupMembers(r.Context(), groupID)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	invites, err := a.store.GroupPendingInvites(r.Context(), groupID)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"group":   g,
		"members": nonNil(members),
		"invites": nonNil(invites),
	})
}

func (a *API) deleteGroup(w http.ResponseWriter, r *http.Request) {
	err := a.store.DeleteGroup(r.Context(), chi.URLParam(r, "groupID"), currentUser(r).ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		a.writeError(w, r, errGroupNotFound)
	case errors.Is(err, store.ErrForbidden):
		a.writeError(w, r, &apiError{Status: http.StatusForbidden, Code: "not_owner", Message: "Only the group owner can delete it."})
	case err != nil:
		a.writeError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a *API) leaveGroup(w http.ResponseWriter, r *http.Request) {
	err := a.store.LeaveGroup(r.Context(), chi.URLParam(r, "groupID"), currentUser(r).ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		a.writeError(w, r, errGroupNotFound)
	case errors.Is(err, store.ErrOwnerLeave):
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "owner_cannot_leave", Message: "Owners can't leave their own group. Delete it instead."})
	case err != nil:
		a.writeError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a *API) createInvite(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	groupID := chi.URLParam(r, "groupID")
	var body struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		a.writeError(w, r, err)
		return
	}
	username, err := auth.NormalizeUsername(body.Username)
	if err != nil {
		a.writeError(w, r, errBadRequest("invalid_username", "That isn't a valid username."))
		return
	}
	if username == me.Username {
		a.writeError(w, r, errBadRequest("cannot_invite_self", "You're already in this group."))
		return
	}
	if _, err := a.store.GroupForMember(r.Context(), groupID, me.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			err = errGroupNotFound
		}
		a.writeError(w, r, err)
		return
	}
	invitee, err := a.store.UserByUsername(r.Context(), username)
	if errors.Is(err, store.ErrNotFound) {
		a.writeError(w, r, &apiError{Status: http.StatusNotFound, Code: "user_not_found", Message: "No one is called @" + username + " yet."})
		return
	}
	if err != nil {
		a.writeError(w, r, err)
		return
	}

	err = a.store.CreateInvite(r.Context(), groupID, me.ID, invitee.ID)
	switch {
	case errors.Is(err, store.ErrAlreadyMember):
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "already_member", Message: "@" + username + " is already in this group."})
	case errors.Is(err, store.ErrConflict):
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "already_invited", Message: "@" + username + " already has a pending invite."})
	case errors.Is(err, store.ErrGroupFull):
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "group_full", Message: "This group is full."})
	case err != nil:
		a.writeError(w, r, err)
	default:
		writeJSON(w, http.StatusCreated, map[string]string{"status": "invited", "username": username})
	}
}

func (a *API) pendingInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := a.store.PendingInvitesFor(r.Context(), currentUser(r).ID)
	if err != nil {
		a.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, nonNil(invites))
}

func (a *API) acceptInvite(w http.ResponseWriter, r *http.Request)  { a.respondInvite(w, r, true) }
func (a *API) declineInvite(w http.ResponseWriter, r *http.Request) { a.respondInvite(w, r, false) }

func (a *API) respondInvite(w http.ResponseWriter, r *http.Request, accept bool) {
	err := a.store.RespondInvite(r.Context(), chi.URLParam(r, "inviteID"), currentUser(r).ID, accept)
	switch {
	case errors.Is(err, store.ErrNotFound):
		a.writeError(w, r, &apiError{Status: http.StatusNotFound, Code: "invite_not_found", Message: "This invite is no longer available."})
	case errors.Is(err, store.ErrGroupFull):
		a.writeError(w, r, &apiError{Status: http.StatusConflict, Code: "group_full", Message: "This group is full."})
	case err != nil:
		a.writeError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
