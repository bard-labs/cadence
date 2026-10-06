import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const rawApi = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const rawWs = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
const rawMedia = process.env.NEXT_PUBLIC_MEDIA_URL ?? "http://localhost:9000";
const sameOrigin = !rawApi || rawApi === "same-origin";

const origin = (url: string) => {
  if (!url || url === "same-origin") return "'self'";
  return new URL(url).origin;
};

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://images.unsplash.com ${sameOrigin ? "" : origin(rawMedia)}`.trim(),
  "font-src 'self'",
  sameOrigin
    ? `connect-src 'self'${isDev ? " ws://localhost:* http://localhost:*" : ""}`
    : `connect-src 'self' ${origin(rawApi)} ${origin(rawWs)} ${origin(rawMedia)}${isDev ? " ws://localhost:*" : ""}`,
  `media-src 'self' blob: data:${sameOrigin ? "" : ` ${origin(rawMedia)}`}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Do NOT set upgrade-insecure-requests: LAN access is http://192.168.100.100
  // and that directive would force CSS/JS onto https:// and break styling.
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ["@bardlabs/cadence-protocol"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
