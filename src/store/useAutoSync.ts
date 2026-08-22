import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { socketUrl } from '../lib/api';
import { useAuth } from './useAuth';
import { syncOutbox } from './useStore';

/**
 * Safety-net poll. The socket does the real work; this only covers the case
 * where it is down and has not managed to reconnect yet, so it is deliberately
 * slow — a fast poll alongside a working socket is pure waste.
 */
const FALLBACK_POLL_MS = 60000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Heartbeat, and how long silence is allowed to last before the socket is
 * assumed dead.
 *
 * `readyState` cannot be trusted on its own. When iOS suspends a backgrounded
 * PWA the TCP connection dies with no FIN, so `onclose` never fires and the
 * socket reports OPEN for as long as the page lives. That is not a cosmetic
 * problem: the fallback poll below was gated on the socket *not* being OPEN,
 * so a zombie socket silenced the live updates and the safety net at the same
 * time. Someone actively using the app would simply stop seeing their
 * friends' expenses, with nothing on screen to suggest anything was wrong.
 *
 * The ping is in-band because the browser gives JavaScript no view of
 * protocol-level pongs; the server answers `{type:'pong'}` in kind.
 */
const PING_MS = 25000;
const SILENCE_LIMIT_MS = 70000;

/**
 * A socket this young is left alone.
 *
 * Resuming fires several lifecycle events at once — visibilitychange, focus
 * and pageshow all land together — and iOS adds its own. Without this, each
 * one tears down the connection the previous one just opened.
 */
const FRESH_SOCKET_MS = 5000;

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
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let backoff = RECONNECT_MIN_MS;
    let closed = false;
    // Anything at all from the server counts, pongs included.
    let lastHeard = Date.now();
    let socketStartedAt = 0;

    const visible = () =>
      Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden;

    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(socketUrl(token));
        socketStartedAt = Date.now();
      } catch {
        schedule();
        return;
      }

      socket.onopen = () => {
        backoff = RECONNECT_MIN_MS;
        lastHeard = Date.now();
        // A live socket is the earliest proof the server is reachable again,
        // so push what was written offline before pulling — otherwise the
        // refresh below reports state that is knowably out of date.
        void syncOutbox().then(refresh);
      };
      socket.onmessage = (event) => {
        lastHeard = Date.now();
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

    /** Throw the socket away and build a new one. */
    const recycle = () => {
      // One that was just opened cannot be a casualty of a suspend that
      // happened before it existed.
      if (socket && Date.now() - socketStartedAt < FRESH_SOCKET_MS) return;
      const dead = socket;
      socket = null;
      if (dead) {
        // Detach first: this close is deliberate, and letting onclose run
        // would schedule a second, backed-off reconnect racing this one.
        dead.onopen = dead.onmessage = dead.onerror = dead.onclose = null;
        try {
          dead.close();
        } catch {
          // Already gone; nothing to do.
        }
      }
      backoff = RECONNECT_MIN_MS;
      connect();
    };

    const onForeground = () => {
      if (!visible()) return;
      void syncOutbox().then(refresh);
      // Always rebuild rather than testing readyState. Coming back to the
      // foreground is exactly the moment a suspended iOS PWA is holding a
      // socket that died while it was away but still claims to be OPEN, and
      // one handshake is far cheaper than silently never syncing again.
      recycle();
    };

    void syncOutbox().then(refresh);
    connect();

    // Prove the connection both ways. A socket that has gone quiet past the
    // limit is replaced outright rather than trusted, which is the only thing
    // that recovers a connection killed by a network handover — there is no
    // foreground event for switching from WiFi to cellular.
    pingTimer = setInterval(() => {
      if (!visible() || !socket) return;
      if (Date.now() - lastHeard > SILENCE_LIMIT_MS) {
        recycle();
        return;
      }
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          recycle();
        }
      }
    }, PING_MS);

    pollTimer = setInterval(() => {
      if (!visible()) return;
      // Deliberately no longer gated on readyState alone: that check is what
      // let a zombie socket disable the safety net it exists to be.
      const silent = Date.now() - lastHeard > SILENCE_LIMIT_MS;
      if (!socket || socket.readyState !== WebSocket.OPEN || silent) {
        void syncOutbox().then(refresh);
      }
    }, FALLBACK_POLL_MS);

    const cleanups: (() => void)[] = [];
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onForeground);
      window.addEventListener('focus', onForeground);
      // iOS restores a standalone PWA from the back/forward cache without
      // necessarily firing either of the above, and `focus` in particular is
      // unreliable in standalone mode. pageshow is the one event that can be
      // counted on there, so it carries the same recovery.
      const onPageShow = (e: PageTransitionEvent) => {
        // Only a restore. On a normal load the effect above has already
        // connected, and recovering again would just churn the connection.
        if (e.persisted) onForeground();
      };
      window.addEventListener('pageshow', onPageShow);
      // The browser knows the radio is back well before a socket retry is due,
      // which makes this the difference between an expense uploading now and
      // uploading up to 30s later.
      const onOnline = () => {
        backoff = RECONNECT_MIN_MS;
        onForeground();
      };
      window.addEventListener('online', onOnline);
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', onForeground);
        window.removeEventListener('focus', onForeground);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('online', onOnline);
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
      if (pingTimer) clearInterval(pingTimer);
      socket?.close();
      cleanups.forEach((off) => off());
    };
  }, [status, token, refresh]);
}
