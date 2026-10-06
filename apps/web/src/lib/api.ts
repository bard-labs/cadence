import type { RoomSnapshot } from "@bardlabs/cadence-protocol";

import { env } from "@/lib/env";

export type User = { id: string; username: string; createdAt: string };

export type Group = {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "member";
  memberCount: number;
  createdAt: string;
};

export type Member = { userId: string; username: string; role: "owner" | "member"; joinedAt: string };

export type Invite = {
  id: string;
  groupId: string;
  groupName: string;
  inviterUsername: string;
  inviteeUsername: string;
  createdAt: string;
};

export type GroupDetail = { group: Group; members: Member[]; invites: Invite[] };

export type Friend = {
  userId: string;
  username: string;
  groups: string[];
  lastTrackId: string | null;
  lastTrackTitle: string | null;
  lastPlayedAt: string | null;
  live: RoomSnapshot;
};

export type TrackStatus = "processing" | "ready" | "failed";

export type Track = {
  id: string;
  title: string;
  status: TrackStatus;
  uploaderId: string;
  uploaderUsername: string;
  manifestUrl?: string;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  genre?: string | null;
  coverUrl?: string;
  codec?: string | null;
  sampleRate?: number | null;
  channels?: number | null;
  bitrate?: number | null;
  hasLyrics?: boolean;
  /** Present only on a single-track read. */
  lyrics?: string | null;
};

export type UploadTarget = {
  url: string;
  fields: Record<string, string>;
  objectKey: string;
  maxBytes: number;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Network failures, timeouts and 5xx are worth retrying; 4xx are not. */
  get retryable() {
    return this.status === 0 || this.status >= 500;
  }
}

export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}

const TIMEOUT_MS = 15_000;

type RequestOptions = { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal };

function redirectToLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  const next = window.location.pathname + window.location.search;
  // Full navigation on purpose: drops every in-memory cache, socket and player from the old session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function request<T>(path: string, { method = "GET", body, signal }: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method,
      credentials: "include",
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeout.aborted) throw new ApiError(0, "timeout", "Cadence is taking too long to respond. Please try again.");
    throw new ApiError(0, "network", "Can't reach Cadence. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    const err = new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Request failed (${res.status}).`);
    if (res.status === 401 && !path.startsWith("/v1/auth/")) redirectToLogin();
    throw err;
  }
  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<User>("/v1/auth/register", { method: "POST", body: { username, password } }),
  login: (username: string, password: string) =>
    request<User>("/v1/auth/login", { method: "POST", body: { username, password } }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST", body: {} }),
  me: (signal?: AbortSignal) => request<User>("/v1/me", { signal }),

  friends: (signal?: AbortSignal) => request<Friend[]>("/v1/friends", { signal }),

  groups: (signal?: AbortSignal) => request<Group[]>("/v1/groups", { signal }),
  group: (id: string, signal?: AbortSignal) => request<GroupDetail>(`/v1/groups/${encodeURIComponent(id)}`, { signal }),
  createGroup: (name: string) => request<Group>("/v1/groups", { method: "POST", body: { name } }),
  deleteGroup: (id: string) => request<void>(`/v1/groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
  leaveGroup: (id: string) => request<void>(`/v1/groups/${encodeURIComponent(id)}/leave`, { method: "POST", body: {} }),
  invite: (groupId: string, username: string) =>
    request<{ status: string; username: string }>(`/v1/groups/${encodeURIComponent(groupId)}/invites`, {
      method: "POST",
      body: { username },
    }),

  invites: (signal?: AbortSignal) => request<Invite[]>("/v1/invites", { signal }),
  acceptInvite: (id: string) =>
    request<void>(`/v1/invites/${encodeURIComponent(id)}/accept`, { method: "POST", body: {} }),
  declineInvite: (id: string) =>
    request<void>(`/v1/invites/${encodeURIComponent(id)}/decline`, { method: "POST", body: {} }),

  tracks: async (opts: { page?: number; pageSize?: number; q?: string } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (opts.q?.trim()) params.set("q", opts.q.trim());
    // Tolerate a bare array from an older API binary so the library never goes blank.
    const data = await request<TrackPage | Track[]>(`/v1/tracks?${params}`, { signal });
    if (Array.isArray(data)) {
      return { items: data, page: 1, pageSize: data.length, total: data.length, totalPages: data.length > 0 ? 1 : 0 };
    }
    return {
      items: data.items ?? [],
      page: data.page ?? page,
      pageSize: data.pageSize ?? pageSize,
      total: data.total ?? 0,
      totalPages: data.totalPages ?? 0,
    };
  },
  track: (id: string, signal?: AbortSignal) => request<Track>(`/v1/tracks/${encodeURIComponent(id)}`, { signal }),
  createUpload: () => request<UploadTarget>("/v1/uploads", { method: "POST", body: {} }),
  createTrack: (title: string, objectKey: string, titleAuto = false) =>
    request<Track>("/v1/tracks", { method: "POST", body: { title, objectKey, titleAuto } }),
};

export type TrackPage = {
  items: Track[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const queryKeys = {
  me: ["me"] as const,
  friends: ["friends"] as const,
  groups: ["groups"] as const,
  group: (id: string) => ["groups", id] as const,
  invites: ["invites"] as const,
  tracks: (page: number, q: string) => ["tracks", page, q] as const,
  track: (id: string) => ["tracks", "one", id] as const,
};
