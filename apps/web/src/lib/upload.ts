import { ApiError, type UploadTarget } from "@/lib/api";

export const ACCEPTED_AUDIO = ".mp3,.wav,.flac,.ogg,.m4a,.aac,.aiff,.aif,audio/*";

/** Browsers sometimes leave `type` empty (e.g. .flac on Windows), so fall back to the extension. */
export function audioContentType(file: File): string | null {
  if (file.type.startsWith("audio/")) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    aiff: "audio/aiff",
    aif: "audio/aiff",
  };
  return ext ? (byExt[ext] ?? null) : null;
}

export function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Uploads straight to object storage with the presigned POST policy from the API. */
export function uploadToStorage(
  target: UploadTarget,
  file: File,
  contentType: string,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
    form.append("Content-Type", contentType);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", target.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const tooLarge = xhr.responseText.includes("EntityTooLarge");
      reject(
        new ApiError(
          xhr.status,
          tooLarge ? "upload_too_large" : "upload_failed",
          tooLarge ? "That file is too large." : "The upload was rejected by storage. Please try again.",
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
