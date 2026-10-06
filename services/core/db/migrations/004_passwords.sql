-- +goose Up
-- Password auth replaces guest claim-on-first-use. Keep existing users and
-- their tracks: assign an unusable hash so old guest accounts cannot sign in
-- (they must register a new username). DELETE would cascade-wipe the library.
ALTER TABLE users
    ADD COLUMN password_hash TEXT;

UPDATE users
SET password_hash = '$2a$12$SqX2GJngTBuurn8MmW8cxeMfwrMBVp3MMMHAp.7wnPInXT6MxH/ka'
WHERE password_hash IS NULL;

ALTER TABLE users
    ALTER COLUMN password_hash SET NOT NULL;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
