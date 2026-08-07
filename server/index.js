/**
 * Splitwise Clone API.
 *
 * Dependency-free HTTP server over node:sqlite. Binds loopback only — Tailscale
 * Funnel is the sole path in from the internet, so the process itself never
 * needs to be exposed on the LAN or tailnet.
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

import { WebSocketServer } from 'ws';

import { openDb } from './db.js';
import {
  checkThrottle,
  clearFailures,
  createSession,
  hashPassword,
  recordFailure,
  sha256,
  userForToken,
  verifyPassword,
} from './auth.js';
import { exchangeCode, googleEnabled } from './google.js';
import { runOcr } from './ocr.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname;

const db = openDb(DB_PATH);
const now = () => new Date().toISOString();

/* ------------------------------ helpers ------------------------------ */

function send(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // The web app is served from a different Funnel port, so it is a
    // cross-origin caller. Credentials travel in the Authorization header,
    // not cookies, so a wildcard origin is safe here.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(payload);
}

const fail = (res, status, error) => send(res, status, { ok: false, error });

async function readJson(req, limitBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      // Refuse oversized bodies rather than buffering them: receipt uploads
      // are the only large payload and they are capped client-side.
      if (size > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function requireUser(req, res) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = userForToken(db, token);
  if (!user) {
    fail(res, 401, 'Not signed in');
    return null;
  }
  return user;
}

function isMember(groupId, userId) {
  return !!db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId);
}

const emailValid = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
/** Opaque per-install id from the client; only used to avoid echoing back. */
const deviceOf = (req) => String(req.headers['x-device-id'] ?? '') || null;

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? '?').trim();

/* --------------------------- serialisation --------------------------- */

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    // An alias has a synthetic address; never show it as if it were real.
    email: row.placeholder ? '' : row.email,
    colorIndex: row.color_index ?? 0,
    isAlias: !!row.placeholder,
  };
}

function groupPayload(groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return null;
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.color_index, u.placeholder
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = ?`
    )
    .all(groupId)
    .map(publicUser);
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    currency: group.currency,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    memberIds: members.map((m) => m.id),
    members,
  };
}

function expensePayload(row) {
  const payers = db
    .prepare('SELECT user_id, amount FROM expense_payers WHERE expense_id = ?')
    .all(row.id);
  const splits = db
    .prepare('SELECT user_id, amount FROM expense_splits WHERE expense_id = ?')
    .all(row.id);
  return {
    id: row.id,
    groupId: row.group_id,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    splitMethod: row.split_method,
    date: row.date,
    notes: row.notes ?? undefined,
    isSettlement: !!row.is_settlement,
    deleted: !!row.deleted,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidBy: payers.map((p) => ({ personId: p.user_id, amount: p.amount })),
    splits: splits.map((s) => ({ personId: s.user_id, amount: s.amount })),
  };
}

/* ------------------------------- routes ------------------------------- */

const routes = {
  'POST /api/auth/signup': async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    const password = String(body.password ?? '');

    if (!emailValid(email)) return fail(res, 400, 'Enter a valid email address');
    if (name.length < 1) return fail(res, 400, 'Name is required');
    if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');

    const taken = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    if (taken) return fail(res, 409, 'An account with that email already exists');

    const id = randomUUID();
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, color_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, email, name, hashPassword(password), count % 8, now());

    const session = createSession(db, id);
    send(res, 201, {
      ok: true,
      token: session.token,
      user: { id, name, email, colorIndex: count % 8 },
    });
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const key = sha256(`${email}|${clientIp(req)}`);

    const throttle = checkThrottle(db, key);
    if (!throttle.allowed) {
      return fail(res, 429, `Too many attempts. Try again in ${throttle.retryInMin} minutes.`);
    }

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Same message and code either way: distinguishing them tells an attacker
    // which emails are registered.
    // A blank hash is a Google-only account: there is no password to match,
    // and verifyPassword would be doing the rejecting by accident rather than
    // on purpose.
    if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) {
      recordFailure(db, key);
      return fail(res, 401, 'Incorrect email or password');
    }

    clearFailures(db, key);
    const session = createSession(db, row.id);
    send(res, 200, { ok: true, token: session.token, user: publicUser(row) });
  },

  'POST /api/auth/google': async (req, res) => {
    if (!googleEnabled()) return fail(res, 503, 'Google sign-in is not configured on this server');

    const body = await readJson(req);
    const code = String(body.code ?? '');
    if (!code) return fail(res, 400, 'Missing authorization code');

    let profile;
    try {
      profile = await exchangeCode({
        code,
        codeVerifier: body.codeVerifier ? String(body.codeVerifier) : '',
        redirectUri: String(body.redirectUri ?? ''),
        clientId: body.clientId ? String(body.clientId) : '',
      });
    } catch (err) {
      return fail(res, 400, err?.message ?? 'Google sign-in failed');
    }

    // Match on sub first, then fall back to the address so that someone who
    // signed up with a password can start using the Google button without
    // ending up with a second, empty account.
    let row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profile.sub);
    if (!row) {
      const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
      if (byEmail && !byEmail.placeholder) {
        db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(profile.sub, byEmail.id);
        row = { ...byEmail, google_sub: profile.sub };
      } else if (byEmail) {
        // A placeholder is a name someone typed into a group, not an account.
        // Claiming it is a separate, deliberate flow; silently turning it into
        // a login would attach a stranger to that group's history.
        return fail(res, 409, 'That address is already used by someone in a group. Sign in with a password to claim it.');
      }
    }

    if (!row) {
      const id = randomUUID();
      const colorIndex = db.prepare('SELECT COUNT(*) AS n FROM users').get().n % 8;
      // Empty password_hash marks an account with no password at all.
      // verifyPassword rejects it, so the login route can never match on it.
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, color_index, created_at, google_sub)
         VALUES (?, ?, ?, '', ?, ?, ?)`
      ).run(id, profile.email, profile.name, colorIndex, now(), profile.sub);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    const session = createSession(db, row.id);
    send(res, 200, { ok: true, token: session.token, user: publicUser(row) });
  },

  'POST /api/auth/logout': async (req, res) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    send(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const user = requireUser(req, res);
    if (user) send(res, 200, { ok: true, user });
  },

  'POST /api/groups': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const name = String(body.name ?? '').trim();
    if (!name) return fail(res, 400, 'Group name is required');

    const id = randomUUID();
    const ts = now();
    db.prepare(
      `INSERT INTO groups (id, name, type, currency, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, String(body.type ?? 'other'), String(body.currency ?? 'INR'), user.id, ts, ts);
    db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      id,
      user.id,
      ts
    );
    send(res, 201, { ok: true, group: groupPayload(id) });
  },

  'POST /api/groups/update': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    const name = String(body.name ?? '').trim();
    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');
    if (!name) return fail(res, 400, 'Group name is required');
    db.prepare('UPDATE groups SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), groupId);
    broadcast(groupId, deviceOf(req));
    send(res, 200, { ok: true, group: groupPayload(groupId) });
  },

  'POST /api/groups/delete': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return fail(res, 404, 'Group not found');
    // Only the creator can delete: it destroys history for everyone in it.
    if (group.created_by !== user.id) {
      return fail(res, 403, 'Only the person who created the group can delete it');
    }
    const members = db
      .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
      .all(groupId)
      .map((r) => r.user_id);
    const payload = JSON.stringify({ type: 'changed', groupId });
    // Cascades clear members, invites, expenses and their shares.
    db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
    for (const ws of clients) {
      if (ws.readyState === 1 && members.includes(ws.userId)) {
        try { ws.send(payload); } catch { clients.delete(ws); }
      }
    }
    send(res, 200, { ok: true });
  },

  'POST /api/groups/leave': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');

    // Leaving with an outstanding balance would strand the debt: the numbers
    // stop adding up for everyone left behind.
    let net = 0;
    for (const row of db.prepare('SELECT id FROM expenses WHERE group_id = ? AND deleted = 0').all(groupId)) {
      const paid = db.prepare('SELECT amount FROM expense_payers WHERE expense_id = ? AND user_id = ?').get(row.id, user.id);
      const owed = db.prepare('SELECT amount FROM expense_splits WHERE expense_id = ? AND user_id = ?').get(row.id, user.id);
      net += (paid?.amount ?? 0) - (owed?.amount ?? 0);
    }
    if (net !== 0) {
      const amount = (Math.abs(net) / 100).toFixed(2);
      return fail(res, 409, net > 0
        ? `You are still owed ${amount} in this group. Settle up before leaving.`
        : `You still owe ${amount} in this group. Settle up before leaving.`);
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, user.id);
    broadcast(groupId, deviceOf(req));
    send(res, 200, { ok: true });
  },

  'POST /api/groups/members': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    const name = String(body.name ?? '').trim();
    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');
    if (!name) return fail(res, 400, 'A name is required');

    // Someone with no account, so imported expenses can reference them.
    const id = randomUUID();
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, color_index, created_at, placeholder)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(id, `placeholder+${id}@local.invalid`, name, 'x', count % 8, now());
    db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      groupId, id, now()
    );
    broadcast(groupId, deviceOf(req));
    send(res, 201, { ok: true, member: { id, name, email: '', colorIndex: count % 8 } });
  },

  /**
   * Take over an alias's history.
   *
   * When someone was tracked by name (imported, or added before they had an
   * account) and later signs up, their expenses must move to the real account
   * rather than being re-entered. Only the person themselves can claim an
   * alias — letting one member reassign another's identity would be a way to
   * quietly rewrite who owes what.
   */
  'POST /api/groups/claim': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    const aliasId = String(body.aliasId ?? '');

    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');
    const alias = db.prepare('SELECT * FROM users WHERE id = ?').get(aliasId);
    if (!alias) return fail(res, 404, 'That person no longer exists');
    if (!alias.placeholder) return fail(res, 400, 'That person already has an account');
    if (!isMember(groupId, aliasId)) return fail(res, 400, 'They are not in this group');
    if (aliasId === user.id) return fail(res, 400, 'That is already you');

    const expenseIds = db
      .prepare('SELECT id FROM expenses WHERE group_id = ?')
      .all(groupId)
      .map((r) => r.id);

    db.exec('BEGIN');
    try {
      for (const table of ['expense_payers', 'expense_splits']) {
        for (const expenseId of expenseIds) {
          const aliasRow = db
            .prepare(`SELECT amount FROM ${table} WHERE expense_id = ? AND user_id = ?`)
            .get(expenseId, aliasId);
          if (!aliasRow) continue;
          const mineRow = db
            .prepare(`SELECT amount FROM ${table} WHERE expense_id = ? AND user_id = ?`)
            .get(expenseId, user.id);
          if (mineRow) {
            // Both appear on the same expense: merge, or the composite
            // primary key (expense_id, user_id) would collide.
            db.prepare(`UPDATE ${table} SET amount = ? WHERE expense_id = ? AND user_id = ?`)
              .run(mineRow.amount + aliasRow.amount, expenseId, user.id);
            db.prepare(`DELETE FROM ${table} WHERE expense_id = ? AND user_id = ?`)
              .run(expenseId, aliasId);
          } else {
            db.prepare(`UPDATE ${table} SET user_id = ? WHERE expense_id = ? AND user_id = ?`)
              .run(user.id, expenseId, aliasId);
          }
        }
      }

      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, aliasId);
      // Keep the alias if it is still carrying history in another group.
      const stillUsed = db
        .prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?')
        .get(aliasId).n;
      if (stillUsed === 0) db.prepare('DELETE FROM users WHERE id = ?').run(aliasId);

      db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now(), groupId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      return fail(res, 400, `Could not link that person: ${err.message}`);
    }

    broadcast(groupId, null);
    send(res, 200, { ok: true, group: groupPayload(groupId) });
  },

  'POST /api/invites': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');

    // Short, unambiguous code: no 0/O/1/I so it can be read aloud or typed.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    const expires = new Date(Date.now() + 14 * 864e5).toISOString();
    db.prepare(
      'INSERT INTO invites (code, group_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(code, groupId, user.id, now(), expires);
    send(res, 201, { ok: true, code, expiresAt: expires });
  },

  'POST /api/join': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const code = String(body.code ?? '').trim().toUpperCase();

    const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
    if (!invite) return fail(res, 404, 'That invite code is not valid');
    if (new Date(invite.expires_at) < new Date()) return fail(res, 410, 'That invite has expired');

    if (!isMember(invite.group_id, user.id)) {
      db.prepare(
        'INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)'
      ).run(invite.group_id, user.id, now());
      db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now(), invite.group_id);
      // Tell existing members someone joined; they are the ones who would
      // otherwise have to reload to see the new person.
      broadcast(invite.group_id, deviceOf(req));
    }
    send(res, 200, { ok: true, group: groupPayload(invite.group_id) });
  },

  'POST /api/expenses': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');

    const amount = Math.round(Number(body.amount ?? 0));
    const paidBy = Array.isArray(body.paidBy) ? body.paidBy : [];
    const splits = Array.isArray(body.splits) ? body.splits : [];
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, 'Amount must be positive');

    const sum = (rows) => rows.reduce((a, r) => a + Math.round(Number(r.amount ?? 0)), 0);
    // Reject unbalanced ledgers at the door. If these ever disagree the
    // group's balances become wrong for everyone, permanently.
    if (sum(paidBy) !== amount) return fail(res, 400, 'Payments do not add up to the amount');
    if (sum(splits) !== amount) return fail(res, 400, 'Splits do not add up to the amount');

    const id = String(body.id ?? randomUUID());
    const ts = now();
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT OR REPLACE INTO expenses
          (id, group_id, description, amount, currency, category, split_method, date,
           notes, is_settlement, created_by, created_at, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(
        id,
        groupId,
        String(body.description ?? 'Expense'),
        amount,
        String(body.currency ?? 'INR'),
        String(body.category ?? 'general'),
        String(body.splitMethod ?? 'equal'),
        String(body.date ?? ts.slice(0, 10)),
        body.notes ? String(body.notes) : null,
        body.isSettlement ? 1 : 0,
        user.id,
        ts,
        ts
      );
      db.prepare('DELETE FROM expense_payers WHERE expense_id = ?').run(id);
      db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(id);
      const insP = db.prepare(
        'INSERT INTO expense_payers (expense_id, user_id, amount) VALUES (?, ?, ?)'
      );
      const insS = db.prepare(
        'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)'
      );
      for (const p of paidBy) insP.run(id, String(p.personId), Math.round(Number(p.amount)));
      for (const s of splits) insS.run(id, String(s.personId), Math.round(Number(s.amount)));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      return fail(res, 400, `Could not save expense: ${err.message}`);
    }

    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    broadcast(groupId, deviceOf(req));
    send(res, 201, { ok: true, expense: expensePayload(row) });
  },

  'POST /api/expenses/delete': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(String(body.id ?? ''));
    if (!row) return fail(res, 404, 'Expense not found');
    if (!isMember(row.group_id, user.id)) return fail(res, 403, 'You are not in that group');
    db.prepare('UPDATE expenses SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
    broadcast(row.group_id, deviceOf(req));
    send(res, 200, { ok: true });
  },

  'GET /api/sync': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const groupIds = db
      .prepare('SELECT group_id FROM group_members WHERE user_id = ?')
      .all(user.id)
      .map((r) => r.group_id);

    const groups = groupIds.map(groupPayload).filter(Boolean);
    const expenses = [];
    for (const gid of groupIds) {
      for (const row of db.prepare('SELECT * FROM expenses WHERE group_id = ?').all(gid)) {
        expenses.push(expensePayload(row));
      }
    }
    // Everyone the user shares a group with, so the client can render names
    // and avatars without a second round trip. The user is always included —
    // a brand-new account has no groups, and the client still needs to be able
    // to resolve its own name and avatar.
    const people = new Map([[user.id, user]]);
    for (const g of groups) for (const m of g.members) people.set(m.id, m);

    send(res, 200, {
      ok: true,
      user,
      groups,
      expenses,
      people: [...people.values()],
      syncedAt: now(),
    });
  },

  'POST /api/ocr': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.imageBase64) return fail(res, 400, 'No image supplied');
    try {
      const result = await runOcr(String(body.imageBase64), String(body.filename ?? 'receipt.jpg'));
      send(res, 200, { ok: true, ...result });
    } catch (err) {
      fail(res, 502, `OCR failed: ${err.message}`);
    }
  },

  'GET /api/health': async (_req, res) =>
    send(res, 200, { ok: true, service: 'splitwise-api', time: now() }),
};

/* ------------------------------- server ------------------------------- */

const httpServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  // Tailscale Funnel mounts this app at /api and strips that prefix before
  // proxying, so the same route table has to answer both "/api/health"
  // (direct, local) and "/health" (through the funnel).
  let path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api')) path = path === '/' ? '/api' : `/api${path}`;
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return fail(res, 404, `No route for ${req.method} ${path}`);
  try {
    await handler(req, res);
  } catch (err) {
    if (!res.headersSent) fail(res, 400, err.message || 'Request failed');
  }
});

/* ----------------------------- live updates ----------------------------- */

/**
 * Push "something changed in this group" to connected clients.
 *
 * Deliberately a nudge, not a payload: the client re-runs its normal /sync,
 * so there is exactly one code path that turns server state into local state.
 * Sending diffs here would mean a second, subtly different one.
 *
 * Funnel mounts the API at /api and strips the prefix, so the upgrade arrives
 * as /ws.
 */
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url ?? '/', 'http://x');
  if (pathname !== '/ws' && pathname !== '/api/ws') return socket.destroy();

  // Browsers cannot set headers on a WebSocket, so the token rides in the
  // query string. It never leaves the tunnel unencrypted (wss).
  const user = userForToken(db, searchParams.get('token') ?? '');
  if (!user) return socket.destroy();

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = user.id;
    ws.deviceId = searchParams.get('device') ?? null;
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'ready' }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
});

/**
 * Notify a group's members that something changed.
 *
 * Excludes the acting *device*, not the acting user: the same person is often
 * signed in on a phone and a laptop at once, and excluding by user meant their
 * second device never learned about their own change and sat there stale.
 * The device that made the change already has the result, so only it is
 * skipped.
 */
function broadcast(groupId, exceptDeviceId) {
  const members = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(groupId)
    .map((r) => r.user_id);
  const payload = JSON.stringify({ type: 'changed', groupId });
  for (const ws of clients) {
    if (ws.readyState !== 1) continue;
    if (!members.includes(ws.userId)) continue;
    if (exceptDeviceId && ws.deviceId === exceptDeviceId) continue;
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

httpServer.listen(PORT, HOST, () => {
  console.log(`splitwise-api listening on http://${HOST}:${PORT}  (db: ${DB_PATH})`);
  console.log(`google sign-in: ${googleEnabled() ? 'configured' : 'not configured'}`);
});
