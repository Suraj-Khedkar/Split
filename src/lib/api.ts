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

export interface ApiExpenseChange {
  field: string;
  from: string;
  to: string;
}

export interface ApiActivityEntry {
  id: string;
  groupId: string;
  expenseId?: string;
  actorId: string;
  /**
   * Closed set, and both ends of this wire are ours. The Activity screen still
   * falls back to a generic row for an unrecognised value, so a newer server
   * adding one degrades to a plain entry rather than a crash or a dropped
   * record — losing an audit row would be the worse failure.
   */
  action: 'created' | 'edited' | 'deleted' | 'settled' | 'joined';
  at: string;
  summary: string;
  changes: ApiExpenseChange[];
}

/** One line off a scanned receipt. */
export interface ReceiptItem {
  label: string;
  amount: number;
}

export class ApiError extends Error {
  /**
   * The request never reached the server, so retrying it later may well work.
   *
   * A flag rather than something callers have to match on the message: the
   * outbox decides whether to keep or drop a queued change on exactly this,
   * and getting it wrong either jams the queue behind a change the server
   * will never accept, or discards work the user did offline.
   */
  readonly offline: boolean;

  /**
   * "Not now" rather than "no" — the request is still worth repeating.
   *
   * Wider than `offline`: a reply that arrived is not the same as a reply that
   * settles anything. The API sits behind Tailscale Funnel and a local proxy,
   * either of which answers 502/503 of its own when the API process is
   * restarting or the machine is asleep. Those look like ordinary refusals at
   * the fetch layer, and treating them as such is what let a routine API
   * restart drop a queued expense on the floor.
   */
  readonly retryable: boolean;

  /** 0 when the request never got far enough to have one. */
  readonly status: number;

  constructor(
    message: string,
    options: { offline?: boolean; retryable?: boolean; status?: number } = {}
  ) {
    super(message);
    this.offline = options.offline ?? false;
    this.status = options.status ?? 0;
    // Never reaching the server is the original retryable case, so it implies
    // this unless a caller says otherwise.
    this.retryable = options.retryable ?? this.offline;
  }
}

/**
 * Statuses that describe the server's condition rather than the request's.
 *
 * 5xx is the gateway or the API being unavailable, 429 is deliberate
 * backpressure, 408 is the server giving up on a slow upload — all of which a
 * later attempt can resolve. Every other 4xx is a verdict on the request
 * itself and will say exactly the same thing next time.
 */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * Whether a failed call is worth repeating, for callers holding a change that
 * would otherwise be lost. Duck-typed so non-ApiError rejections are handled.
 */
export function isRetryable(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { retryable?: unknown }).retryable === true;
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

/**
 * A lossy connection is the case a plain `fetch` handles worst: it neither
 * succeeds nor rejects, it just hangs — well past the OS's own TCP timeout on
 * some networks. Without a cap, that reads as "the app is stuck" rather than
 * "offline", and everything gated on this request (restore, sync, the outbox
 * drain) sits frozen instead of falling back to the cached/queued state.
 */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * /sync gets far longer, because it is the one call where a slow answer beats
 * no answer.
 *
 * It carries every expense and 300 activity rows per group, and unlike /me it
 * gates nothing: the app has already painted its cached view and is syncing
 * behind it, so waiting costs the user nothing visible. Measured on a
 * 700-expense account over a throttled 50kbps link the round trip took 6.2s —
 * inside the old 10s cap, but not by much, and the payload grows with the
 * ledger. Tripping that cap would not read as "this was slow", it would read
 * as permanently offline, which is the exact complaint this work exists to
 * fix.
 *
 * Receipt OCR gets the same treatment for the opposite reason: it *uploads*
 * a photo, and a slow uplink is the common case.
 */
const SYNC_TIMEOUT_MS = 45000;
const UPLOAD_TIMEOUT_MS = 60000;

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: timeout.signal,
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
    // very different messages in the UI, and only the first is worth retrying.
    // A timeout lands here too: on a bad connection it is exactly as
    // retryable as a dropped connection, and the outbox treats them the same.
    clearTimeout(timer);
    throw new ApiError('Cannot reach the server. Check your connection.', { offline: true });
  }

  const status = response.status;

  // The timer stays armed through the body read, which is the half that
  // actually stalls: headers come back off the first packet, so clearing the
  // timeout here left the download itself with no deadline at all. A response
  // that hangs mid-body then hung the app outright — no error, no fallback to
  // the cached view, just a screen that never finishes loading.
  let text: string;
  try {
    text = await response.text();
  } catch {
    // Aborted by the timer, or the connection dropped mid-response. Either
    // way nothing was read, so the call is as repeatable as one that never
    // left the device.
    throw new ApiError('The connection dropped before the reply finished.', {
      offline: true,
      status,
    });
  } finally {
    clearTimeout(timer);
  }

  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Not our API talking. A proxy or Funnel error page is HTML, and on a
    // transient status it means the API was simply not reachable behind it.
    throw new ApiError(`Unexpected response from server (${status})`, {
      retryable: isTransientStatus(status),
      status,
    });
  }
  if (!response.ok || body.ok === false) {
    throw new ApiError(body.error || `Request failed (${status})`, {
      retryable: isTransientStatus(status),
      status,
    });
  }
  return body as T;
}

export const api = {
  /**
   * Creates the account but returns no session — the address has to be
   * confirmed first, or the check would be decorative.
   */
  signup: (email: string, name: string, password: string) =>
    request<{ pendingVerification: true; email: string; mailConfigured: boolean }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify({ email, name, password }) }
    ),

  /** Confirms an address and signs in, so the emailed link lands in the app. */
  verifyEmail: (token: string) =>
    request<{ token: string; user: ApiUser }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: (email: string) =>
    request<{ mailConfigured: boolean }>('/auth/verify/resend', {
      method: 'POST',
      body: JSON.stringify({ email }),
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

  /** Minimal expense creation — the server fills in payer, split and group. */
  quickAdd: (payload: { amount: string; description?: string; category?: string }) =>
    request<{ message: string }>('/quick-add', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // The .shortcut download URLs are built from the public origin in
  // app/shortcut.tsx rather than here: they are opened in Safari, outside this
  // app entirely, so the relative API_BASE a browser would resolve is no use.

  /** Long-lived token for an automation (iOS Shortcut, bookmarklet). */
  createApiToken: () =>
    request<{ token: string; expiresAt: string }>('/auth/token', { method: 'POST' }),

  /**
   * Attach Google to the account already signed in, rather than signing in as
   * whoever the Google account belongs to.
   */
  linkGoogle: (payload: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }) =>
    request<{ googleEmail: string }>('/auth/google/link', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  unlinkGoogle: () => request<{}>('/auth/google/unlink', { method: 'POST' }),

  logout: () => request<{}>('/auth/logout', { method: 'POST' }),

  /** hasGoogle / hasPassword are reported for the caller's own account only. */
  me: () => request<{ user: ApiUser; hasGoogle: boolean; hasPassword: boolean }>('/me'),

  updateProfile: (payload: { name: string; colorIndex: number }) =>
    request<{ user: ApiUser }>('/me/profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sync: () =>
    request<{
      user: ApiUser;
      groups: ApiGroup[];
      expenses: ApiExpense[];
      activity: ApiActivityEntry[];
      friendIds: string[];
      people: ApiUser[];
      syncedAt: string;
    }>('/sync', {}, SYNC_TIMEOUT_MS),

  /** Connect with someone by email. Mutual — they get you too. */
  addFriend: (email: string) =>
    request<{ friend: ApiUser }>('/friends', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  /** Refused by the server while a shared group still exists. */
  removeFriend: (friendId: string) =>
    request<{}>('/friends/remove', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),

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

  /**
   * Names the group behind a code without needing an account, so someone
   * following a share link sees what they are joining before signing up.
   */
  inviteInfo: (code: string) =>
    request<{ code: string; groupName: string; invitedBy: string; expiresAt: string }>(
      `/invite-info?code=${encodeURIComponent(code)}`
    ),

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

  /**
   * Edit an existing expense. The server records what changed and returns it,
   * so the caller can tell a real edit from a save that touched nothing.
   */
  updateExpense: (expense: Partial<ApiExpense> & { id: string }) =>
    request<{ expense: ApiExpense; changes: ApiExpenseChange[] }>('/expenses/update', {
      method: 'POST',
      body: JSON.stringify(expense),
    }),

  deleteExpense: (id: string) =>
    request<{}>('/expenses/delete', { method: 'POST', body: JSON.stringify({ id }) }),

  /** The server's VAPID public key, needed to create a push subscription. */
  pushKey: () => request<{ publicKey: string }>('/push/key'),

  pushSubscribe: (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) =>
    request<{}>('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),

  /** Expo push token for the Android build. */
  registerNativePush: (token: string) =>
    request<{}>('/push/native/subscribe', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  unregisterNativePush: (token: string) =>
    request<{}>('/push/native/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  pushUnsubscribe: (endpoint: string) =>
    request<{}>('/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  ocr: (imageBase64: string, filename = 'receipt.jpg') =>
    request<{
      provider: string;
      text: string;
      total: number | null;
      items: ReceiptItem[];
      merchant: string | null;
    }>(
      '/ocr',
      { method: 'POST', body: JSON.stringify({ imageBase64, filename }) },
      UPLOAD_TIMEOUT_MS
    ),
};
