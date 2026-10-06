-- +goose Up
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- NOT VALID keeps any pre-existing dev rows while enforcing the format for new users.
ALTER TABLE users
    ADD CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,20}$') NOT VALID;

ALTER TABLE group_invites ADD COLUMN invitee_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE group_invites gi SET invitee_id = u.id FROM users u WHERE u.username = gi.invitee_username;
DELETE FROM group_invites WHERE invitee_id IS NULL;
ALTER TABLE group_invites ALTER COLUMN invitee_id SET NOT NULL;
ALTER TABLE group_invites DROP COLUMN invitee_username;
CREATE UNIQUE INDEX group_invites_one_pending ON group_invites (group_id, invitee_id) WHERE status = 'pending';
CREATE INDEX group_invites_invitee_idx ON group_invites (invitee_id) WHERE status = 'pending';

CREATE INDEX group_members_user_idx ON group_members (user_id);
CREATE INDEX tracks_created_idx ON tracks (created_at DESC);

ALTER TABLE tracks ADD COLUMN size_bytes BIGINT;
ALTER TABLE tracks ADD COLUMN error TEXT;

-- +goose Down
ALTER TABLE tracks DROP COLUMN IF EXISTS error;
ALTER TABLE tracks DROP COLUMN IF EXISTS size_bytes;
DROP INDEX IF EXISTS tracks_created_idx;
DROP INDEX IF EXISTS group_members_user_idx;
DROP INDEX IF EXISTS group_invites_invitee_idx;
DROP INDEX IF EXISTS group_invites_one_pending;
ALTER TABLE group_invites ADD COLUMN invitee_username TEXT;
UPDATE group_invites gi SET invitee_username = u.username FROM users u WHERE u.id = gi.invitee_id;
ALTER TABLE group_invites DROP COLUMN invitee_id;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format;
DROP TABLE IF EXISTS sessions;
