# ADR-004: HLS via ffmpeg and MinIO

**Decision:** Presigned uploads to S3-compatible storage; worker transcodes to HLS (AAC 128k); browser plays via hls.js.

**Alternatives:** Raw MP3 range requests (simpler, weaker streaming story).
