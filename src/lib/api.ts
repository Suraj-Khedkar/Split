import { Platform } from 'react-native';

import { deviceId } from './device';

/**
 * Client for the self-hosted API on pinaka.
 *
 * On web the app and API are served from the same Funnel origin (`/` and
 * `/api` on port 10000), so a relative base works and there is no CORS.
 * Native builds have no origin to inherit, so they need the absolute URL.
 */
const PUBLIC_API = 'https://pinaka.tail2f85bc.ts.net:10000/api';

export const API_BASE =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.origin}/api`
    : PUBLIC_API;

/** ws:// or wss:// equivalent of API_BASE, for the live-update socket. */
export function socketUrl(token: string): string {
  const base = API_BASE.replace(/^http/, 'ws');
  return `${base}/ws?token=${encodeURIComponent(token)}&device=${encodeURIComponent(deviceId())}`;
}

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  colorIndex: number;
  /** Tracked by name only — no account yet, and claimable when they sign up. */
  isAlias?: boolean;
}

export interface ApiGroup {
  id: string;
  name: string;
  type: string;
  currency: string;
  memberIds: string[];
  members: ApiUser[];
  createdAt: string;
}

export interface ApiExpense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  splitMethod: string;
  date: string;
  notes?: string;
  isSettlement: boolean;
  deleted: boolean;
  createdAt: string;
  paidBy: { personId: string; amount: number }[];
  splits: { personId: string; amount: number }[];
}

export class ApiError extends Error {}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // Lets the server skip pushing a change back to the device that made
        // it, while still reaching this account's other devices.
        'X-Device-Id': deviceId(),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    // Distinguish "server unreachable" from "server said no" — the two need
    // very different messages in the UI.
    throw new ApiError('Cannot reach the server. Check your connection.');
  }

  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Unexpected response from server (${response.status})`);
  }
  if (!response.ok || body.ok === false) {
    throw new ApiError(body.error || `Request failed (${response.status})`);
  }
  return body as T;
}

export const api = {
  signup: (email: string, name: string, password: string) =>
    request<{ token: string; user: ApiUser }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /**
   * Hands the one-time authorization code to our server, which exchanges it
   * with Google using the client secret and answers with our own session.
   */
  google: (payload: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }) =>
    request<{ token: string; user: ApiUser }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () => request<{}>('/auth/logout', { method: 'POST' }),

  me: () => request<{ user: ApiUser }>('/me'),

  sync: () =>
    request<{
      user: ApiUser;
      groups: ApiGroup[];
      expenses: ApiExpense[];
      people: ApiUser[];
      syncedAt: string;
    }>('/sync'),

  createGroup: (name: string, type: string, currency: string) =>
    request<{ group: ApiGroup }>('/groups', {
      method: 'POST',
      body: JSON.stringify({ name, type, currency }),
    }),

  updateGroup: (groupId: string, name: string) =>
    request<{ group: ApiGroup }>('/groups/update', {
      method: 'POST',
      body: JSON.stringify({ groupId, name }),
    }),

  deleteGroup: (groupId: string) =>
    request<{}>('/groups/delete', { method: 'POST', body: JSON.stringify({ groupId }) }),

  leaveGroup: (groupId: string) =>
    request<{}>('/groups/leave', { method: 'POST', body: JSON.stringify({ groupId }) }),

  /** Add someone by name who has no account yet (imports, offline friends). */
  addMember: (groupId: string, name: string) =>
    request<{ member: ApiUser }>('/groups/members', {
      method: 'POST',
      body: JSON.stringify({ groupId, name }),
    }),

  /** Take over an alias's history in a group (only for yourself). */
  claimAlias: (groupId: string, aliasId: string) =>
    request<{ group: ApiGroup }>('/groups/claim', {
      method: 'POST',
      body: JSON.stringify({ groupId, aliasId }),
    }),

  createInvite: (groupId: string) =>
    request<{ code: string; expiresAt: string }>('/invites', {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    }),

  join: (code: string) =>
    request<{ group: ApiGroup }>('/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  createExpense: (expense: Partial<ApiExpense>) =>
    request<{ expense: ApiExpense }>('/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    }),

  deleteExpense: (id: string) =>
    request<{}>('/expenses/delete', { method: 'POST', body: JSON.stringify({ id }) }),

  ocr: (imageBase64: string, filename = 'receipt.jpg') =>
    request<{
      provider: string;
      text: string;
      total: number | null;
      items: { label: string; amount: number }[];
      merchant: string | null;
    }>('/ocr', { method: 'POST', body: JSON.stringify({ imageBase64, filename }) }),
};
