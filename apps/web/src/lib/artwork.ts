// Fallback art when a track has no embedded cover (worker extracts covers when present).
const COVERS = [
  "photo-1493225457124-a3eb161ffa5f",
  "photo-1511379938547-c1f69419868d",
  "photo-1470225620780-dba8ba36b745",
  "photo-1514525253161-7a46d19cd819",
  "photo-1459749411175-04bf5292ceea",
  "photo-1487180144351-b8472da7d491",
  "photo-1506157786151-b8491531f063",
  "photo-1501612780327-45045538702b",
  "photo-1508700115892-45ecd05ae2ad",
  "photo-1446057032654-9d8885db76c6",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coverUrl(seed: string, size = 640): string {
  const id = COVERS[hash(seed) % COVERS.length];
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${size}&h=${size}&q=80`;
}

/** A stable accent hue per person, used for avatars and the stage glow. */
export function userHue(userId: string): number {
  return hash(userId) % 360;
}

export function initials(username: string): string {
  return username.replace(/_/g, "").slice(0, 2).toUpperCase() || "?";
}
