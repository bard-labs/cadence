# Uploads and HLS

## Why the browser uploads straight to storage

Proxying big files through the API ties up API memory and connections. Instead:

1. `POST /v1/uploads` makes the API sign a **POST policy** for one object key, `uploads/<yourUserId>/<uuid>`. The policy only allows:
   - sizes from 1 byte to `CADENCE_MAX_UPLOAD_MB` (default 50 MB)
   - a `Content-Type` that starts with `audio/`
   - 15 minutes of validity

   It's rate-limited to 30 per hour per user.
2. The browser sends a `multipart/form-data` POST to MinIO with the policy fields, the real `Content-Type`, and the file (`lib/upload.ts`, which uses XHR for progress events and cancel).
3. `POST /v1/tracks {title, objectKey, titleAuto}` registers the upload. The API checks that:
   - the key starts with **your** prefix, so you can't register someone else's upload
   - the object exists, and its real size (`StatObject`) is within the limit

   Then one transaction inserts the track (`processing`) and a `transcode` job.

The presigning client is built with `CADENCE_S3_PUBLIC_ENDPOINT` (the host browsers can reach) because the signature covers the host name. Server-to-storage traffic uses `CADENCE_S3_ENDPOINT`, which inside Docker is `minio:9000`.

## The worker

`cmd/worker` loops:

1. **Claim.** One query does `UPDATE jobs ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`, so many workers can run safely. Jobs stuck in `running` past their lease (10 minutes) are reclaimed.
2. **Download** the original to a temp directory.
3. **Probe** with ffprobe. The file must contain an audio stream and be at most 2 hours long. The same probe reads tags: title, artist, album, year, genre, lyrics (capped at 20 KB), codec, sample rate, channels, and bitrate. An attached picture is extracted to a 600×600 JPEG.
4. **Transcode** with ffmpeg to HLS: AAC at 160 kbps, 6-second segments, `seg_0000.ts` and so on. Audio only; the cover is not muxed into the stream.
5. **Upload** the segments first, then `index.m3u8`, then `cover.jpg` when one existed. Players never see a playlist that points at segments that don't exist yet. `hls/*` is already public, so the cover is too.
6. **Mark the track ready.** Duration and the tags are stored on the track. If `title_auto` is set (the uploader left the title as the file name), a non-empty embedded title replaces it. A bad cover does not fail the job. Lyrics are omitted from the library list and returned only from `GET /v1/tracks/{id}`.

Failures retry with exponential backoff, up to 3 attempts. A `PermanentError` (not audio, too long) fails immediately with a readable message stored in `tracks.error`, which the Library shows.

### ffmpeg hardening

User files are untrusted, and ffmpeg understands many formats that can reference *other* files or URLs (playlists, concat). The worker runs with:

```
-protocol_whitelist file
-format_whitelist mp3,wav,flac,ogg,mov,matroska,aac,aiff,w64
```

so a "song" that's really a playlist pointing at `http://internal-service` is rejected.

## Playback

Only `hls/*` is public in the bucket policy. Originals stay private. The player uses hls.js (Chrome, Firefox, Edge) or native HLS (Safari), and recovers from errors:

- network errors retry up to 3 times with backoff
- media errors get `recoverMediaError()` up to 2 times
- anything else shows "Playback stopped because the stream failed"
