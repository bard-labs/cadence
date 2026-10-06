/** Empty apiUrl = same origin (Caddy proxies /v1 and /ws). */
function apiUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw || raw === "same-origin") return "";
  return raw.replace(/\/$/, "");
}

/** Derive ws/wss from the page host when running behind the reverse proxy. */
function wsUrl(): string {
  const raw = process.env.NEXT_PUBLIC_WS_URL;
  if (!raw || raw === "same-origin") {
    if (typeof window === "undefined") return "ws://localhost:8080/ws";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  return raw;
}

export const env = {
  get apiUrl() {
    return apiUrl();
  },
  get wsUrl() {
    return wsUrl();
  },
};
