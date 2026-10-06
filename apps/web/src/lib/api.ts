const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type User = { id: string; username: string; createdAt: string };
export type Group = { id: string; name: string; ownerId: string; createdAt: string };
export type Invite = {
  id: string;
  groupId: string;
  groupName: string;
  inviterUsername: string;
  inviteeUsername: string;
  status: string;
  createdAt: string;
};
export type Track = {
  id: string;
  title: string;
  status: string;
  uploaderId: string;
  manifestUrl?: string;
  durationMs?: number;
  createdAt: string;
};
export type ListeningSession = {
  userId: string;
  username: string;
  trackId?: string;
  trackTitle?: string;
  positionMs: number;
  paused: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const cadenceApi = {
  guestLogin: (username: string) =>
    api<User>("/v1/auth/guest", { method: "POST", body: JSON.stringify({ username }) }),
  me: () => api<User>("/v1/me"),
  listGroups: () => api<Group[]>("/v1/groups"),
  createGroup: (name: string) =>
    api<Group>("/v1/groups", { method: "POST", body: JSON.stringify({ name }) }),
  getGroup: (id: string) =>
    api<{ members: { userId: string; username: string; role: string }[]; listening: ListeningSession[] }>(
      `/v1/groups/${id}`,
    ),
  invite: (groupId: string, username: string) =>
    api<Invite>(`/v1/groups/${groupId}/invites`, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  pendingInvites: () => api<Invite[]>("/v1/invites/pending"),
  acceptInvite: (inviteId: string) =>
    api<{ status: string }>(`/v1/invites/${inviteId}/accept`, { method: "POST" }),
  uploadUrl: () => api<{ objectKey: string; uploadUrl: string }>("/v1/tracks/upload-url", { method: "POST" }),
  createTrack: (title: string, objectKey: string) =>
    api<Track>("/v1/tracks", { method: "POST", body: JSON.stringify({ title, objectKey }) }),
  listTracks: () => api<Track[]>("/v1/tracks"),
  updateListening: (trackId: string, positionMs: number, paused: boolean) =>
    api<{ status: string }>("/v1/listening", {
      method: "POST",
      body: JSON.stringify({ trackId, positionMs, paused }),
    }),
};
