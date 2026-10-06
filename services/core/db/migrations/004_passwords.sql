-- +goose Up
-- Password auth replaces guest claim-on-first-use. Existing guest rows cannot
-- sign in without a hash, so clear them and start clean for local/dev data.
DELETE FROM users;

ALTER TABLE users
    ADD COLUMN password_hash TEXT NOT NULL;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
