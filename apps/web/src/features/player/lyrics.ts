export type LyricLine = { t: number; text: string };

/**
 * Parse LRC (`[mm:ss.xx]line`) or return plain lines timed evenly if there
 * are no timestamps. Empty input returns [].
 */
export function parseLyrics(raw: string | null | undefined, durationMs = 0): LyricLine[] {
  if (!raw?.trim()) return [];
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const timed: LyricLine[] = [];
  const plain: string[] = [];
  const tag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)/;

  for (const line of lines) {
    const m = line.match(tag);
    if (!m) {
      const text = line.trim();
      if (text && !text.startsWith("[")) plain.push(text);
      continue;
    }
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const frac = m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) : 0;
    const text = m[4].trim();
    if (!text) continue;
    timed.push({ t: min * 60_000 + sec * 1000 + frac, text });
  }

  if (timed.length > 0) {
    timed.sort((a, b) => a.t - b.t);
    return timed;
  }
  if (plain.length === 0) return [];
  const step = durationMs > 0 ? durationMs / plain.length : 4000;
  return plain.map((text, i) => ({ t: Math.round(i * step), text }));
}

export function activeLyricIndex(lines: LyricLine[], positionMs: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
