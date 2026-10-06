package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type Group struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	OwnerID     string    `json:"ownerId"`
	Role        string    `json:"role"`
	MemberCount int       `json:"memberCount"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Member struct {
	UserID   string    `json:"userId"`
	Username string    `json:"username"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joinedAt"`
}

type Invite struct {
	ID              string    `json:"id"`
	GroupID         string    `json:"groupId"`
	GroupName       string    `json:"groupName"`
	InviterUsername string    `json:"inviterUsername"`
	InviteeUsername string    `json:"inviteeUsername"`
	CreatedAt       time.Time `json:"createdAt"`
}

type Friend struct {
	UserID       string     `json:"userId"`
	Username     string     `json:"username"`
	Groups       []string   `json:"groups"`
	LastTrackID  *string    `json:"lastTrackId"`
	LastTitle    *string    `json:"lastTrackTitle"`
	LastPlayedAt *time.Time `json:"lastPlayedAt"`
}

func (s *Store) CreateGroup(ctx context.Context, name, ownerID string) (Group, error) {
	var g Group
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var owned int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM groups WHERE owner_id = $1`, ownerID).Scan(&owned); err != nil {
			return err
		}
		if owned >= MaxOwnedGroups {
			return ErrGroupLimit
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO groups (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id, created_at`,
			name, ownerID,
		).Scan(&g.ID, &g.Name, &g.OwnerID, &g.CreatedAt); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, g.ID, ownerID)
		return err
	})
	g.Role = "owner"
	g.MemberCount = 1
	return g, mapErr(err)
}

func (s *Store) ListGroupsForUser(ctx context.Context, userID string) ([]Group, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT g.id, g.name, g.owner_id, me.role,
		       (SELECT count(*) FROM group_members m WHERE m.group_id = g.id),
		       g.created_at
		FROM groups g
		JOIN group_members me ON me.group_id = g.id AND me.user_id = $1
		ORDER BY g.created_at DESC`, userID)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Group, error) {
		var g Group
		err := r.Scan(&g.ID, &g.Name, &g.OwnerID, &g.Role, &g.MemberCount, &g.CreatedAt)
		return g, err
	})
}

// GroupForMember returns ErrNotFound for non-members so group IDs are not enumerable.
func (s *Store) GroupForMember(ctx context.Context, groupID, userID string) (Group, error) {
	var g Group
	err := s.pool.QueryRow(ctx, `
		SELECT g.id, g.name, g.owner_id, me.role,
		       (SELECT count(*) FROM group_members m WHERE m.group_id = g.id),
		       g.created_at
		FROM groups g
		JOIN group_members me ON me.group_id = g.id AND me.user_id = $2
		WHERE g.id = $1`, groupID, userID,
	).Scan(&g.ID, &g.Name, &g.OwnerID, &g.Role, &g.MemberCount, &g.CreatedAt)
	return g, mapErr(err)
}

func (s *Store) GroupMembers(ctx context.Context, groupID string) ([]Member, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, gm.role, gm.joined_at
		FROM group_members gm
		JOIN users u ON u.id = gm.user_id
		WHERE gm.group_id = $1
		ORDER BY gm.role DESC, gm.joined_at`, groupID)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) {
		var m Member
		err := r.Scan(&m.UserID, &m.Username, &m.Role, &m.JoinedAt)
		return m, err
	})
}

func (s *Store) GroupPendingInvites(ctx context.Context, groupID string) ([]Invite, error) {
	return s.queryInvites(ctx, `WHERE gi.group_id = $1 AND gi.status = 'pending'`, groupID)
}

func (s *Store) PendingInvitesFor(ctx context.Context, userID string) ([]Invite, error) {
	return s.queryInvites(ctx, `WHERE gi.invitee_id = $1 AND gi.status = 'pending'`, userID)
}

func (s *Store) queryInvites(ctx context.Context, where string, arg string) ([]Invite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT gi.id, gi.group_id, g.name, inviter.username, invitee.username, gi.created_at
		FROM group_invites gi
		JOIN groups g ON g.id = gi.group_id
		JOIN users inviter ON inviter.id = gi.inviter_id
		JOIN users invitee ON invitee.id = gi.invitee_id
		`+where+`
		ORDER BY gi.created_at DESC`, arg)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Invite, error) {
		var inv Invite
		err := r.Scan(&inv.ID, &inv.GroupID, &inv.GroupName, &inv.InviterUsername, &inv.InviteeUsername, &inv.CreatedAt)
		return inv, err
	})
}

func (s *Store) CreateInvite(ctx context.Context, groupID, inviterID, inviteeID string) error {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var isMember bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)`,
			groupID, inviteeID,
		).Scan(&isMember); err != nil {
			return err
		}
		if isMember {
			return ErrAlreadyMember
		}
		var members int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM group_members WHERE group_id = $1`, groupID).Scan(&members); err != nil {
			return err
		}
		if members >= MaxGroupMembers {
			return ErrGroupFull
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO group_invites (group_id, inviter_id, invitee_id) VALUES ($1, $2, $3)`,
			groupID, inviterID, inviteeID)
		return err
	})
	return mapErr(err)
}

// RespondInvite accepts or declines a pending invite addressed to userID.
func (s *Store) RespondInvite(ctx context.Context, inviteID, userID string, accept bool) error {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var groupID string
		if err := tx.QueryRow(ctx, `
			SELECT group_id FROM group_invites
			WHERE id = $1 AND invitee_id = $2 AND status = 'pending'
			FOR UPDATE`, inviteID, userID,
		).Scan(&groupID); err != nil {
			return err
		}
		status := "declined"
		if accept {
			var members int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM group_members WHERE group_id = $1`, groupID).Scan(&members); err != nil {
				return err
			}
			if members >= MaxGroupMembers {
				return ErrGroupFull
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
				groupID, userID); err != nil {
				return err
			}
			status = "accepted"
		}
		_, err := tx.Exec(ctx, `UPDATE group_invites SET status = $2 WHERE id = $1`, inviteID, status)
		return err
	})
	return mapErr(err)
}

func (s *Store) LeaveGroup(ctx context.Context, groupID, userID string) error {
	g, err := s.GroupForMember(ctx, groupID, userID)
	if err != nil {
		return err
	}
	if g.Role == "owner" {
		return ErrOwnerLeave
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, groupID, userID)
	return mapErr(err)
}

func (s *Store) DeleteGroup(ctx context.Context, groupID, userID string) error {
	g, err := s.GroupForMember(ctx, groupID, userID)
	if err != nil {
		return err
	}
	if g.Role != "owner" {
		return ErrForbidden
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM groups WHERE id = $1`, groupID)
	return mapErr(err)
}

func (s *Store) SharesGroup(ctx context.Context, a, b string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM group_members x
			JOIN group_members y ON y.group_id = x.group_id
			WHERE x.user_id = $1 AND y.user_id = $2
		)`, a, b,
	).Scan(&ok)
	return ok, mapErr(err)
}

func (s *Store) CoMemberIDs(ctx context.Context, userID string) (map[string]struct{}, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT other.user_id
		FROM group_members me
		JOIN group_members other ON other.group_id = me.group_id AND other.user_id <> me.user_id
		WHERE me.user_id = $1`, userID)
	if err != nil {
		return nil, mapErr(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		out[id] = struct{}{}
	}
	return out, nil
}

// Friends lists everyone who shares at least one group with userID, in the
// order they joined, so tabs stay stable as new friends are added.
func (s *Store) Friends(ctx context.Context, userID string) ([]Friend, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username,
		       array_agg(DISTINCT g.name ORDER BY g.name),
		       ls.track_id, t.title, ls.updated_at
		FROM group_members me
		JOIN group_members other ON other.group_id = me.group_id AND other.user_id <> me.user_id
		JOIN groups g ON g.id = me.group_id
		JOIN users u ON u.id = other.user_id
		LEFT JOIN listening_sessions ls ON ls.user_id = u.id
		LEFT JOIN tracks t ON t.id = ls.track_id
		WHERE me.user_id = $1
		GROUP BY u.id, u.username, ls.track_id, t.title, ls.updated_at
		ORDER BY min(other.joined_at), u.username`, userID)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Friend, error) {
		var f Friend
		err := r.Scan(&f.UserID, &f.Username, &f.Groups, &f.LastTrackID, &f.LastTitle, &f.LastPlayedAt)
		return f, err
	})
}
