-- +goose Up
ALTER TABLE tracks
    ADD COLUMN title_auto BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN artist TEXT,
    ADD COLUMN album TEXT,
    ADD COLUMN year INT,
    ADD COLUMN genre TEXT,
    ADD COLUMN lyrics TEXT,
    ADD COLUMN cover_key TEXT,
    ADD COLUMN codec TEXT,
    ADD COLUMN sample_rate INT,
    ADD COLUMN channels INT,
    ADD COLUMN source_bitrate INT;

-- +goose Down
ALTER TABLE tracks
    DROP COLUMN IF EXISTS source_bitrate,
    DROP COLUMN IF EXISTS channels,
    DROP COLUMN IF EXISTS sample_rate,
    DROP COLUMN IF EXISTS codec,
    DROP COLUMN IF EXISTS cover_key,
    DROP COLUMN IF EXISTS lyrics,
    DROP COLUMN IF EXISTS genre,
    DROP COLUMN IF EXISTS year,
    DROP COLUMN IF EXISTS album,
    DROP COLUMN IF EXISTS artist,
    DROP COLUMN IF EXISTS title_auto;
