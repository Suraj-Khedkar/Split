import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { socketUrl } from '../lib/api';
import { useAuth } from './useAuth';

/**
 * Safety-net poll. The socket does the real work; this only covers the case
 * where it is down and has not managed to reconnect yet, so it is deliberately
 * slow — a fast poll alongside a working socket is pure waste.
 */
const FALLBACK_POLL_MS = 60000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Keeps the local ledger live.
 *
 * The server pushes a bare "changed" nudge and the client re-runs its normal
 * /sync. Sending the changed rows over the socket instead would create a second
 * path from server state to local state, which is exactly how the two drift.
 */
export function useAutoSync() {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const refresh = useAuth((s) => s.refresh);

  useEffect(() => {
    if (status !== 'signedIn' || !token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let backoff = RECONNECT_MIN_MS;
    let closed = false;

    const visible = () =>
      Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(socketUrl(token));
      } catch {
        schedule();
        return;
      }

      socket.onopen = () => {
        backoff = RECONNECT_MIN_MS;
        // Catch up on anything missed while disconnected.
        void refresh();
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === 'changed') void refresh();
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        socket = null;
        schedule();
      };
    };

    // Exponential backoff so a server restart does not turn into a hot loop.
    const schedule = () => {
      if (closed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (visible()) connect();
        else schedule();
      }, backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    };

    const onForeground = () => {
      if (!visible()) return;
      void refresh();
      if (!socket) {
        backoff = RECONNECT_MIN_MS;
        connect();
      }
    };

    void refresh();
    connect();
    pollTimer = setInterval(() => {
      if (visible() && (!socket || socket.readyState !== WebSocket.OPEN)) void refresh();
    }, FALLBACK_POLL_MS);

    const cleanups: (() => void)[] = [];
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onForeground);
      window.addEventListener('focus', onForeground);
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', onForeground);
        window.removeEventListener('focus', onForeground);
      });
    } else {
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') onForeground();
      });
      cleanups.push(() => sub.remove());
    }

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      socket?.close();
      cleanups.forEach((off) => off());
    };
  }, [status, token, refresh]);
}
