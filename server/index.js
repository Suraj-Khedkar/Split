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
  newSessionToken,
  recordFailure,
  sha256,
  userForToken,
  verifyPassword,
} from './auth.js';
import { exchangeCode, googleEnabled } from './google.js';
import { VERIFY_TTL_HOURS, verificationHtml } from './emails.js';
import { mailConfigured, sendMail } from './mail.js';
import { runOcr } from './ocr.js';
import { sendPush, vapidKeys } from './push.js';
import { buildFullShortcut, buildQuickAddShortcut } from './shortcut.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname;
/** Where a notification tap should open the app. */
const PUBLIC_WEB_BASE = process.env.PUBLIC_WEB_BASE ?? 'https://pinaka.tail2f85bc.ts.net:10000';
/** Must match avatarColors in src/theme — an index past the end has no colour. */
const AVATAR_COLOR_COUNT = 8;
/** RFC 8292 requires a contact; push services use it to report problems. */
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:brightlof@gmail.com';

const db = openDb(DB_PATH);
const now = () => new Date().toISOString();
const PUSH_KEYS = vapidKeys(db);

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

const isPersonalGroup = (groupId) =>
  db.prepare("SELECT 1 FROM groups WHERE id = ? AND type = 'personal'").get(groupId) != null;

/**
 * The caller's private, single-member group — where solo spending lives.
 *
 * Modelled as an ordinary group so every existing path (membership checks,
 * /sync, broadcast, expense create and delete) works on it untouched. It is
 * hidden from the Groups tab client-side and cannot be invited to, joined,
 * left or deleted, so it never behaves like a shared group anywhere it matters.
 *
 * Created on demand from /sync rather than at signup: that way accounts that
 * already exist get one on their next poll, with no migration and no
 * bootstrapping step in the client.
 */
function personalGroupFor(userId) {
  const find = () =>
    db
      .prepare("SELECT id FROM groups WHERE created_by = ? AND type = 'personal'")
      .get(userId)?.id ?? null;

  const existing = find();
  if (existing) return existing;

  const id = randomUUID();
  const ts = now();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO groups (id, name, type, currency, created_by, created_at, updated_at)
       VALUES (?, 'Personal', 'personal', 'INR', ?, ?, ?)`
    ).run(id, userId, ts, ts);
    db.prepare('INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      id,
      userId,
      ts
    );
    db.exec('COMMIT');
    return id;
  } catch (err) {
    db.exec('ROLLBACK');
    // Lost the race against a concurrent sync from another device; the unique
    // index did its job and the other one is just as good.
    const raced = find();
    if (raced) return raced;
    throw err;
  }
}

const emailValid = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
/** Opaque per-install id from the client; only used to avoid echoing back. */
const deviceOf = (req) => String(req.headers['x-device-id'] ?? '') || null;

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? '?').trim();

/* --------------------------- serialisation --------------------------- */


/**
 * Mint a verification link and email it.
 *
 * The raw token goes in the link and only the hash is stored, so the table is
 * useless to anyone who reads it. Any earlier link for the same user is
 * dropped first — a resend should invalidate what it replaces, or an old
 * message sitting in an inbox stays usable for a day.
 */
async function sendVerification(user) {
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
  // newSessionToken returns { token, hash } — the raw value for the link, the
  // hash for storage. Same shape the session table uses.
  const { token, hash } = newSessionToken();
  const expires = new Date(Date.now() + VERIFY_TTL_HOURS * 3600e3).toISOString();
  db.prepare(
    'INSERT INTO email_verifications (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(hash, user.id, now(), expires);

  const link = `${PUBLIC_WEB_BASE}/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      to: user.email,
      subject: 'Confirm your email for Split & Track',
      text: [
        `Hi ${user.name},`,
        '',
        'Confirm this address to finish setting up your account:',
        '',
        link,
        '',
        `The link stops working in ${VERIFY_TTL_HOURS} hours.`,
        'If you did not sign up, ignore this — no account can be used until it is confirmed.',
      ].join('\n'),
      html: verificationHtml(user.name, link),
    });
  } catch (err) {
    // Never fail the request over delivery. The account exists, the token is
    // valid, and there is a resend endpoint; throwing here would leave the
    // user with an account they were told was not created.
    console.error('could not send verification email:', err?.message ?? err);
  }
  return link;
}

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

/**
 * Split a total into n whole minor units that sum back to exactly the total.
 *
 * The same rule the app uses: the remainder goes to the first few people
 * rather than being dropped. Losing a paisa here would make the ledger
 * unbalanced, and the expense endpoint would rightly reject it.
 */
function splitEvenly(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return Array.from({ length: count }, () => base + (remainder-- > 0 ? 1 : 0));
}

/**
 * Parse an amount a human typed. "250", "250.50", "₹1,250" all work.
 *
 * Quick-add takes major units because it is driven by a Shortcut prompt, where
 * nobody is going to type paise. Everything past this point is minor units, as
 * everywhere else.
 */
function parseMajorAmount(input) {
  const cleaned = String(input ?? '').replace(/[^0-9.]/g, '');
  if (!cleaned) return NaN;
  return Math.round(Number(cleaned) * 100);
}

/** Every group the user can file an expense against, personal one included. */
function targetsFor(userId) {
  return db
    .prepare(
      `SELECT g.id, g.name, g.type
         FROM groups g
         JOIN group_members m ON m.group_id = g.id
        WHERE m.user_id = ?
        ORDER BY g.type = 'personal' DESC, g.name COLLATE NOCASE`
    )
    .all(userId);
}

/**
 * Resolve a group the user named rather than one identified by id.
 *
 * A Shortcut picks from a list of names, because carrying an id through
 * Shortcuts means extracting a dictionary value for every choice — several
 * more actions, each one a thing to get wrong. Names are matched
 * case-insensitively, and "personal" always finds the private ledger even if
 * it has been renamed.
 */
function groupByName(userId, name) {
  const wanted = String(name).trim().toLowerCase();
  if (!wanted) return null;
  const mine = targetsFor(userId);
  return (
    mine.find((g) => g.name.toLowerCase() === wanted) ??
    (wanted === 'personal' ? mine.find((g) => g.type === 'personal') : null) ??
    null
  );
}

/**
 * Create an expense from the smallest possible input.
 *
 * Shared by the POST and GET forms of quick-add so the two can never drift:
 * one validation path, one split rule, one confirmation message.
 */
async function quickAdd(req, res, user, body) {
  const amount = parseMajorAmount(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail(res, 400, 'Enter an amount greater than zero');
  }

  // Default to wherever you last spent: with one group it is unambiguous,
  // and with several it is nearly always the one you mean. Falling back to the
  // personal ledger rather than an arbitrary group means a Back Tap always has
  // somewhere sensible to land, even on an account with no groups at all.
  let groupId = body.groupId ? String(body.groupId) : '';

  if (!groupId && body.group) {
    const match = groupByName(user.id, body.group);
    // Naming a group that does not exist is a typo, not an instruction to
    // guess — silently filing it somewhere else is how an expense goes missing.
    if (!match) {
      return fail(res, 400, `You are not in a group called "${String(body.group).trim()}"`);
    }
    groupId = match.id;
  }

  if (!groupId) {
    const recent = db
      .prepare(
        `SELECT e.group_id AS id
           FROM expenses e
           JOIN group_members m ON m.group_id = e.group_id AND m.user_id = ?
          WHERE e.deleted = 0
          ORDER BY e.created_at DESC
          LIMIT 1`
      )
      .get(user.id);
    groupId = recent?.id ?? personalGroupFor(user.id);
  }
  if (!groupId) return fail(res, 400, 'Join or create a group first');
  if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');

  const members = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at')
    .all(groupId)
    .map((r) => r.user_id);
  if (!members.length) return fail(res, 400, 'That group has no members');

  const group = db.prepare('SELECT name, type, currency FROM groups WHERE id = ?').get(groupId);
  const shares = splitEvenly(amount, members.length);
  const id = randomUUID();
  const ts = now();
  const category = String(body.category ?? 'general').trim().toLowerCase() || 'general';
  // Fall back to the category rather than a generic "Quick add": a list of
  // rows all called the same thing is no more useful than no description.
  const description = String(body.description ?? '').trim() || category;
  // A Shortcut's optional field arrives as an empty string when skipped, and
  // storing that would show as a blank notes section rather than none at all.
  const note = String(body.note ?? body.notes ?? '').trim();

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO expenses
        (id, group_id, description, amount, currency, category, split_method, date,
         notes, is_settlement, created_by, created_at, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, 'equal', ?, ?, 0, ?, ?, ?, 0)`
    ).run(
      id,
      groupId,
      description,
      amount,
      group?.currency ?? 'INR',
      category,
      String(body.date ?? ts.slice(0, 10)),
      note || null,
      user.id,
      ts,
      ts
    );
    const insP = db.prepare('INSERT INTO expense_payers (expense_id, user_id, amount) VALUES (?, ?, ?)');
    const insS = db.prepare('INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)');
    insP.run(id, user.id, amount);
    members.forEach((memberId, i) => insS.run(id, memberId, shares[i]));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('quick-add failed:', err?.message ?? err);
    return fail(res, 500, 'Could not save that expense');
  }

  broadcast(groupId, deviceOf(req));
  notifyNewExpense(
    groupId,
    deviceOf(req),
    db.prepare('SELECT * FROM expenses WHERE id = ?').get(id),
    user.name
  );
  const major = (amount / 100).toFixed(2);
  const money = `${group?.currency === 'INR' ? '\u20b9' : ''}${major}`;
  send(res, 201, {
    ok: true,
    expense: expensePayload(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)),
    // A single line the Shortcut shows as its confirmation. It names the group
    // and the share, because filing something against the wrong group is the
    // one mistake this flow can make that is worth catching immediately.
    message:
      group?.type === 'personal'
        ? `Added ${money} for "${description}" to Personal`
        : `Added ${money} for "${description}" to ${group?.name ?? 'your group'}` +
          ` \u2014 your share ${group?.currency === 'INR' ? '\u20b9' : ''}${(
            shares[members.indexOf(user.id)] / 100 || 0
          ).toFixed(2)}`,
  });
}

/**
 * The Shortcut runs off the device, so it needs the public origin rather than
 * whatever host this process happens to be bound to.
 */
const shortcutBase = () =>
  process.env.PUBLIC_API_BASE ?? 'https://pinaka.tail2f85bc.ts.net:10000/api';

/**
 * Hand a .shortcut file to the phone.
 *
 * `attachment` makes Safari save it to Files, which is the route that reliably
 * ends in Shortcuts offering to import. `inline` is offered as an alternative
 * because Safari will sometimes recognise the type and hand it straight over,
 * skipping the trip through Files — but it will also happily render the plist
 * as text if it does not, so it is not the default.
 */
function sendShortcut(res, body, filename, inline = false) {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/x-shortcut',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}.shortcut"`,
    // Without a length iOS receives a chunked response, and Safari will sit on
    // an attachment of unknown size rather than offering it — which reads as a
    // download that never finishes.
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

/** Both shortcut downloads, which differ only in which builder they call. */
function shortcutRoute(req, res, which) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') ?? '';
  if (!userForToken(db, token)) return fail(res, 401, 'That link is not valid any more');
  const baseUrl = shortcutBase();
  const inline = url.searchParams.get('inline') === '1';
  return which === 'full'
    ? sendShortcut(res, buildFullShortcut({ baseUrl, token }), 'Add expense', inline)
    : sendShortcut(res, buildQuickAddShortcut({ baseUrl, token }), 'Log expense', inline);
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

function activityPayload(row) {
  let changes = [];
  try {
    if (row.detail) changes = JSON.parse(row.detail);
  } catch {
    // A row whose detail will not parse still records that the event happened,
    // which is the part that matters; losing the detail beats losing the row.
  }
  return {
    id: row.id,
    groupId: row.group_id,
    expenseId: row.expense_id ?? undefined,
    actorId: row.actor_id,
    action: row.action,
    at: row.at,
    summary: row.summary ?? '',
    changes,
  };
}

/**
 * Append one event to the trail.
 *
 * Never throws into the caller: a failure to log must not roll back the thing
 * being logged, or a corrupt log row would become a way to block edits
 * entirely. Callers that need atomicity run this inside their own transaction.
 */
function logActivity({ groupId, expenseId = null, actorId, action, summary = null, detail = null }) {
  try {
    db.prepare(
      `INSERT INTO activity_log (id, group_id, expense_id, actor_id, action, at, summary, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      groupId,
      expenseId,
      actorId,
      action,
      now(),
      summary,
      detail ? JSON.stringify(detail) : null
    );
  } catch (err) {
    console.error('could not write activity log:', err?.message ?? err);
  }
}

/** Display name for the audit log, resolved once at write time. */
function nameOf(userId) {
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  return u?.name ?? 'someone';
}

function moneyText(minor, currency) {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

/**
 * "Alice INR 300.00, Bob INR 200.00" for a payer or split list.
 *
 * Sorted by person so that a pure reordering never registers as a change: the
 * client rebuilds both lists from scratch on every save, and without this the
 * log would fill up with edits nobody actually made.
 */
function sharesText(shares, currency) {
  return [...shares]
    .sort((a, b) => a.personId.localeCompare(b.personId))
    .map((s) => `${nameOf(s.personId)} ${moneyText(s.amount, currency)}`)
    .join(', ');
}

/**
 * What changed between two versions of an expense, rendered at write time.
 *
 * Stored as text rather than raw values because this is a record of what a
 * person saw and agreed to. Names and formatting are resolved now, so the log
 * still reads correctly after someone changes their display name or leaves.
 */
function diffExpense(before, next) {
  const changes = [];
  const push = (field, from, to) => {
    if (String(from) !== String(to)) changes.push({ field, from: String(from), to: String(to) });
  };
  push('description', before.description, next.description);
  push('amount', moneyText(before.amount, before.currency), moneyText(next.amount, next.currency));
  push('currency', before.currency, next.currency);
  push('category', before.category, next.category);
  push('split method', before.splitMethod, next.splitMethod);
  push('date', before.date, next.date);
  push('notes', before.notes ?? '—', next.notes ?? '—');
  push('paid by', sharesText(before.paidBy, before.currency), sharesText(next.paidBy, next.currency));
  push('split', sharesText(before.splits, before.currency), sharesText(next.splits, next.currency));
  return changes;
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

    // Deliberately no session. Handing one out here would make the whole
    // check cosmetic: the point is that nobody uses this address until they
    // have proved they can read mail sent to it.
    await sendVerification({ id, name, email });
    send(res, 201, {
      ok: true,
      pendingVerification: true,
      email,
      // Tells the client whether to say "check your inbox" or "ask the admin
      // for the link", which is the honest wording when nothing is configured.
      mailConfigured: mailConfigured(),
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

    // The whole point of the check. Refused after the password is verified,
    // not before, so this never doubles as a way to test whether an address
    // is registered.
    if (!row.email_verified) {
      return fail(
        res,
        403,
        'Confirm your email address first — check your inbox for the link.'
      );
    }

    const session = createSession(db, row.id);
    send(res, 200, { ok: true, token: session.token, user: publicUser(row) });
  },

  /**
   * Confirm an address and sign in.
   *
   * Returns a session on success, so following the link out of the inbox lands
   * straight in the app rather than back at a login form.
   */
  'POST /api/auth/verify': async (req, res) => {
    const body = await readJson(req);
    const token = String(body.token ?? '');
    if (!token) return fail(res, 400, 'That link is missing its token');

    const row = db
      .prepare('SELECT * FROM email_verifications WHERE token_hash = ?')
      .get(sha256(token));
    if (!row) return fail(res, 404, 'That link is not valid. Ask for a new one.');
    if (new Date(row.expires_at) < new Date()) {
      db.prepare('DELETE FROM email_verifications WHERE token_hash = ?').run(sha256(token));
      return fail(res, 410, 'That link has expired. Ask for a new one.');
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!user) return fail(res, 404, 'That account is gone');

    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
    // Single use.
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);

    const session = createSession(db, user.id);
    send(res, 200, { ok: true, token: session.token, user: publicUser(user) });
  },

  'POST /api/auth/verify/resend': async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Answer the same way whether or not the address exists. Signup already
    // reveals which addresses are taken, so this is not airtight, but there is
    // no reason for this endpoint to be a second confirmation.
    if (user && !user.email_verified && !user.placeholder) {
      await sendVerification(user);
    }
    send(res, 200, { ok: true, mailConfigured: mailConfigured() });
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
        `INSERT INTO users (id, email, name, password_hash, color_index, created_at, google_sub, email_verified)
         VALUES (?, ?, ?, '', ?, ?, ?, 1)`
      ).run(id, profile.email, profile.name, colorIndex, now(), profile.sub);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    // Google has asserted this address, which is exactly the proof the
    // verification email asks for — so a pending password signup is settled by
    // signing in with Google instead.
    if (!row.email_verified) {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(row.id);
    }

    const session = createSession(db, row.id);
    send(res, 200, { ok: true, token: session.token, user: publicUser(row) });
  },

  /**
   * Attach a Google account to the account you are already signed in to.
   *
   * Distinct from POST /api/auth/google, which is "sign me in, creating an
   * account if needed". This one never creates or switches accounts: it is for
   * someone who signed up with a password and now wants the Google button to
   * reach that same ledger instead of starting an empty second one.
   *
   * The account's email is deliberately left alone. Overwriting it with the
   * Google address would silently break password sign-in for anyone whose two
   * addresses differ.
   */
  'POST /api/auth/google/link': async (req, res) => {
    if (!googleEnabled()) return fail(res, 503, 'Google sign-in is not configured on this server');
    const user = requireUser(req, res);
    if (!user) return;

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

    // Claiming a sub already in use would hand this account someone else's
    // way in, and leave that person unable to sign in with Google at all.
    const taken = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(profile.sub);
    if (taken && taken.id !== user.id) {
      return fail(res, 409, 'That Google account is already linked to another account here');
    }

    const mine = db.prepare('SELECT google_sub FROM users WHERE id = ?').get(user.id);
    if (mine?.google_sub && mine.google_sub !== profile.sub) {
      return fail(res, 409, 'This account is already linked to a different Google account');
    }

    db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(profile.sub, user.id);
    send(res, 200, { ok: true, googleEmail: profile.email });
  },

  'POST /api/auth/google/unlink': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const row = db
      .prepare('SELECT google_sub, password_hash FROM users WHERE id = ?')
      .get(user.id);
    if (!row?.google_sub) return fail(res, 400, 'That account is not linked to Google');
    // An account created through Google has an empty password_hash, so
    // unlinking would remove the only way back in — permanently, since there
    // is no password-reset flow to recover through.
    if (!row.password_hash) {
      return fail(
        res,
        409,
        'Google is the only way into this account, so it cannot be unlinked.'
      );
    }
    db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(user.id);
    send(res, 200, { ok: true });
  },

  /**
   * One-shot expense creation for an iOS Shortcut (Back Tap), a browser
   * bookmarklet, or anything else that cannot build a split.
   *
   * Deliberately forgiving where the full endpoint is strict: amount in rupees,
   * everything else optional. It fills in the payer (you), an equal split
   * across the group, today's date, and the group you used last.
   */
  'POST /api/quick-add': async (req, res) => {
    const body = await readJson(req);
    // Accept the token in the body as well as the header. Setting a header in
    // Shortcuts is a separate, easily-missed panel, and a JSON body is the
    // form that survives spaces and ampersands in a note — which a query
    // string, unescaped by Shortcuts, does not.
    const user = body.token ? userForToken(db, String(body.token)) : requireUser(req, res);
    if (!user) {
      if (body.token) fail(res, 401, 'That token is not valid any more');
      return;
    }
    return quickAdd(req, res, user, body);
  },

  /**
   * The lists a Shortcut offers the user: where it can go, and what it can be.
   *
   * Fetched at run time rather than baked into the Shortcut, so a group created
   * today shows up without rebuilding anything. Both are plain arrays of
   * strings because "Choose from List" can display those directly — a list of
   * dictionaries would need a Get Dictionary Value for every pick.
   */
  'GET /api/quick-add/options': async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const header = req.headers.authorization ?? '';
    const token = url.searchParams.get('token') ?? (header.startsWith('Bearer ') ? header.slice(7) : '');
    const user = userForToken(db, token);
    if (!user) return fail(res, 401, 'That link is not valid any more');

    // Built-ins first, in the app's own order, then anything invented since —
    // discovered from the ledger, exactly as the app's picker does it.
    const builtIn = [
      'general', 'food', 'groceries', 'transport', 'home',
      'utilities', 'entertainment', 'travel', 'shopping',
    ];
    const used = db
      .prepare(
        `SELECT DISTINCT e.category
           FROM expenses e
           JOIN group_members m ON m.group_id = e.group_id AND m.user_id = ?
          WHERE e.deleted = 0 AND e.is_settlement = 0`
      )
      .all(user.id)
      .map((r) => r.category)
      .filter((cat) => cat && cat !== 'settlement' && !builtIn.includes(cat));

    send(res, 200, {
      ok: true,
      groups: targetsFor(user.id).map((g) => g.name),
      categories: [...builtIn, ...used.sort()],
    });
  },

  /**
   * The same thing over GET, with the token in the query string.
   *
   * Exists so an iOS Shortcut can be two actions instead of six: "Get Contents
   * of URL" defaults to GET with no headers and no body, which is the part
   * people get wrong. The trade is a token in a URL rather than a header —
   * acceptable against your own server, and the reason this token can be
   * revoked on its own.
   */
  'GET /api/quick-add': async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    const user = userForToken(db, token);
    if (!user) return fail(res, 401, 'That link is not valid any more');
    return quickAdd(req, res, user, {
      amount: url.searchParams.get('amount'),
      description: url.searchParams.get('description'),
      category: url.searchParams.get('category'),
      groupId: url.searchParams.get('groupId'),
      group: url.searchParams.get('group'),
      note: url.searchParams.get('note'),
      date: url.searchParams.get('date'),
    });
  },

  /**
   * A ready-made Shortcuts file, with your token already wired in.
   *
   * Served as a download so the phone hands it to the Shortcuts app. The URL
   * carries the token because Safari follows it as a plain link — the same
   * trade as GET quick-add, and revocable the same way.
   */
  'GET /api/shortcut': async (req, res) => shortcutRoute(req, res, 'quick'),
  'GET /api/shortcut/full': async (req, res) => shortcutRoute(req, res, 'full'),

  /**
   * The same two files under a path that ends in `.shortcut`.
   *
   * The Shortcuts app's own `shortcuts://import-shortcut?url=` handler decides
   * what it is being handed partly by the path extension, and a bare
   * `/shortcut/full?token=…` is not obviously a shortcut to it. Aliases cost
   * nothing and remove a failure mode that looks, from the phone, like the
   * download simply hanging.
   */
  'GET /api/shortcut.shortcut': async (req, res) => shortcutRoute(req, res, 'quick'),
  'GET /api/shortcut/full.shortcut': async (req, res) => shortcutRoute(req, res, 'full'),

  /**
   * Long-lived token for an automation that cannot run a login flow.
   *
   * Same session mechanism as everything else, just with a far-off expiry, so
   * revoking it is the ordinary "sign out everywhere" path rather than a
   * separate concept nobody would remember exists.
   */
  'POST /api/auth/token': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const session = createSession(db, user.id, 3650);
    send(res, 201, { ok: true, token: session.token, expiresAt: session.expiresAt });
  },

  'POST /api/auth/logout': async (req, res) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    send(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const row = db
      .prepare('SELECT google_sub, password_hash FROM users WHERE id = ?')
      .get(user.id);
    // Reported only for the caller's own account. publicUser is handed to
    // everyone sharing a group, and which sign-in methods someone uses is
    // nobody else's business.
    send(res, 200, {
      ok: true,
      user,
      hasGoogle: Boolean(row?.google_sub),
      hasPassword: Boolean(row?.password_hash),
    });
  },

  /**
   * Change your own display name and avatar colour.
   *
   * Google fills both in at first sign-in and a password signup only asks for
   * a name, so without this there was no way to correct either afterwards.
   */
  'POST /api/me/profile': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);

    const name = String(body.name ?? '').trim();
    if (!name) return fail(res, 400, 'Name cannot be empty');
    if (name.length > 60) return fail(res, 400, 'That name is too long');

    // The palette is a fixed list shared with the client. An index outside it
    // would render as a missing colour rather than failing anywhere visible.
    const colorIndex = Number(body.colorIndex);
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= AVATAR_COLOR_COUNT) {
      return fail(res, 400, 'That avatar colour does not exist');
    }

    db.prepare('UPDATE users SET name = ?, color_index = ? WHERE id = ?').run(
      name,
      colorIndex,
      user.id
    );
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

    // This name sits on every expense the user has ever paid for, so everyone
    // sharing a group needs to re-sync rather than keep showing the old one.
    for (const g of db
      .prepare('SELECT group_id FROM group_members WHERE user_id = ?')
      .all(user.id)) {
      broadcast(g.group_id, deviceOf(req));
    }

    send(res, 200, { ok: true, user: publicUser(row) });
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
    // Deleting it would cascade away every personal expense and /sync would
    // quietly hand back a fresh empty one, which reads as data loss.
    if (group.type === 'personal') {
      return fail(res, 400, 'Your personal ledger cannot be deleted');
    }
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
    if (isPersonalGroup(groupId)) {
      return fail(res, 400, 'You cannot leave your own personal ledger');
    }

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
    if (isPersonalGroup(groupId)) {
      return fail(res, 400, 'Your personal ledger is just you — add a group to share with someone');
    }

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

  /**
   * What an invite code refers to, for someone who is not signed in yet.
   *
   * Unauthenticated on purpose: a person following a share link has no account
   * at that moment, and telling them which group they are about to join is the
   * difference between signing up and closing the tab. Exposure is limited to
   * the group name and the inviter's display name — never the member list,
   * balances, expenses or any id — and the code itself is already a secret the
   * caller had to possess to get here.
   */
  'GET /api/invite-info': async (req, res) => {
    const code = String(new URL(req.url ?? '/', 'http://x').searchParams.get('code') ?? '')
      .trim()
      .toUpperCase();
    if (!code) return fail(res, 400, 'No invite code given');

    const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
    if (!invite) return fail(res, 404, 'That invite link is not valid');
    if (new Date(invite.expires_at) < new Date()) return fail(res, 410, 'That invite has expired');

    const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(invite.group_id);
    const inviter = db.prepare('SELECT name FROM users WHERE id = ?').get(invite.created_by);
    send(res, 200, {
      ok: true,
      code,
      groupName: group?.name ?? 'a group',
      invitedBy: inviter?.name ?? '',
      expiresAt: invite.expires_at,
    });
  },

  'POST /api/invites': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const groupId = String(body.groupId ?? '');
    if (!isMember(groupId, user.id)) return fail(res, 403, 'You are not in that group');
    if (isPersonalGroup(groupId)) {
      return fail(res, 400, 'Your personal spending is private and cannot be shared');
    }

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
      logActivity({
        groupId: invite.group_id,
        actorId: user.id,
        action: 'joined',
        summary: user.name,
      });
      // Tell existing members someone joined; they are the ones who would
      // otherwise have to reload to see the new person.
      broadcast(invite.group_id, deviceOf(req));
    }
    send(res, 200, { ok: true, group: groupPayload(invite.group_id) });
  },

  /**
   * Connect two accounts, by email.
   *
   * Mutual and immediate — no request to accept. There is no privacy boundary
   * to defend here: knowing someone's address already lets you add them to a
   * group, and a pending-invitation flow would be a second inbox to build and
   * a second thing to forget about.
   */
  'POST /api/friends': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) return fail(res, 400, 'An email address is required');

    const other = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!other) {
      return fail(res, 404, 'Nobody here uses that address. They need an account first.');
    }
    if (other.placeholder) {
      // A placeholder is a name typed into a group, not an account — it has a
      // synthetic address and nobody can sign in as it.
      return fail(res, 400, 'That person does not have an account yet');
    }
    if (other.id === user.id) return fail(res, 400, 'That is you');
    if (!other.email_verified) {
      // Otherwise someone could squat an address they do not own and receive
      // friend requests meant for its real owner.
      return fail(res, 409, 'They have not confirmed that email address yet');
    }

    const ts = now();
    const link = db.prepare(
      'INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)'
    );
    // Both directions, so the connection shows up on their side too.
    link.run(user.id, other.id, ts);
    link.run(other.id, user.id, ts);

    send(res, 201, { ok: true, friend: publicUser(other) });
  },

  'POST /api/friends/remove': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const friendId = String(body.friendId ?? '');
    if (!friendId) return fail(res, 400, 'Which friend?');

    // Refuse while a shared group still exists. Dropping the connection would
    // not remove them from the group or settle anything between you — it would
    // only hide someone you still owe money to, which is the opposite of what
    // this app is for. Personal ledgers have one member and never count.
    const shared = db
      .prepare(
        `SELECT g.id, g.name
           FROM groups g
           JOIN group_members a ON a.group_id = g.id AND a.user_id = ?
           JOIN group_members b ON b.group_id = g.id AND b.user_id = ?
          WHERE g.type != 'personal'`
      )
      .all(user.id, friendId);
    if (shared.length) {
      const names = shared.map((g) => g.name).join(', ');
      return fail(
        res,
        409,
        `You still share ${shared.length === 1 ? 'a group' : 'groups'} with them (${names}). Leave ${shared.length === 1 ? 'it' : 'those'} first.`
      );
    }

    db.prepare(
      'DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)'
    ).run(user.id, friendId, friendId, user.id);
    send(res, 200, { ok: true });
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
    // A settlement is an expense in the ledger but a different event to a
    // reader: "Alice paid Bob" is not "Alice added a bill".
    logActivity({
      groupId,
      expenseId: id,
      actorId: user.id,
      action: row.is_settlement ? 'settled' : 'created',
      summary: `${row.description} · ${moneyText(row.amount, row.currency)}`,
    });
    broadcast(groupId, deviceOf(req));
    notifyNewExpense(groupId, deviceOf(req), row, user.name);
    send(res, 201, { ok: true, expense: expensePayload(row) });
  },

  /**
   * Edit an existing expense, leaving a record of what moved.
   *
   * Separate from POST /api/expenses even though that one upserts: going
   * through it would stamp created_by and created_at with the editor and the
   * current time, so an expense would silently change author every time
   * somebody corrected a typo, and nothing would be logged.
   */
  'POST /api/expenses/update': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const id = String(body.id ?? '');

    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!row) return fail(res, 404, 'Expense not found');
    if (row.deleted) return fail(res, 410, 'That expense was deleted');
    if (!isMember(row.group_id, user.id)) return fail(res, 403, 'You are not in that group');

    const amount = Math.round(Number(body.amount ?? 0));
    const paidBy = Array.isArray(body.paidBy) ? body.paidBy : [];
    const splits = Array.isArray(body.splits) ? body.splits : [];
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, 'Amount must be positive');

    const sum = (rows) => rows.reduce((a, r) => a + Math.round(Number(r.amount ?? 0)), 0);
    // Same gate as creation: an edit is just as capable of leaving the group's
    // balances permanently wrong.
    if (sum(paidBy) !== amount) return fail(res, 400, 'Payments do not add up to the amount');
    if (sum(splits) !== amount) return fail(res, 400, 'Splits do not add up to the amount');

    const before = expensePayload(row);
    const next = {
      description: String(body.description ?? row.description),
      amount,
      currency: String(body.currency ?? row.currency),
      category: String(body.category ?? row.category),
      splitMethod: String(body.splitMethod ?? row.split_method),
      date: String(body.date ?? row.date),
      notes: body.notes ? String(body.notes) : null,
      paidBy: paidBy.map((p) => ({
        personId: String(p.personId),
        amount: Math.round(Number(p.amount)),
      })),
      splits: splits.map((s) => ({
        personId: String(s.personId),
        amount: Math.round(Number(s.amount)),
      })),
    };

    const changes = diffExpense(before, next);
    if (changes.length === 0) {
      // Opening the form and saving without touching anything is not an edit.
      // Logging it anyway would bury the real changes in noise.
      return send(res, 200, { ok: true, expense: before, changes: [] });
    }

    const ts = now();
    db.exec('BEGIN');
    try {
      db.prepare(
        `UPDATE expenses SET description = ?, amount = ?, currency = ?, category = ?,
           split_method = ?, date = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        next.description,
        next.amount,
        next.currency,
        next.category,
        next.splitMethod,
        next.date,
        next.notes,
        ts,
        id
      );
      // created_by and created_at stay as they were: the expense keeps saying
      // who raised it, and the edit log says who changed it.
      db.prepare('DELETE FROM expense_payers WHERE expense_id = ?').run(id);
      db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(id);
      const insP = db.prepare(
        'INSERT INTO expense_payers (expense_id, user_id, amount) VALUES (?, ?, ?)'
      );
      const insS = db.prepare(
        'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)'
      );
      for (const p of next.paidBy) insP.run(id, p.personId, p.amount);
      for (const s of next.splits) insS.run(id, s.personId, s.amount);
      db.prepare(
        `INSERT INTO activity_log (id, group_id, expense_id, actor_id, action, at, summary, detail)
         VALUES (?, ?, ?, ?, 'edited', ?, ?, ?)`
      ).run(
        randomUUID(),
        row.group_id,
        id,
        user.id,
        ts,
        `${next.description} · ${moneyText(next.amount, next.currency)}`,
        JSON.stringify(changes)
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      return fail(res, 400, `Could not save the edit: ${err.message}`);
    }

    const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    broadcast(row.group_id, deviceOf(req));
    send(res, 200, { ok: true, expense: expensePayload(updated), changes });
  },

  'POST /api/expenses/delete': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(String(body.id ?? ''));
    if (!row) return fail(res, 404, 'Expense not found');
    if (!isMember(row.group_id, user.id)) return fail(res, 403, 'You are not in that group');
    db.prepare('UPDATE expenses SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
    // The expense is tombstoned and disappears from every client, so this row
    // becomes the only remaining evidence it ever existed. Record enough to
    // recognise what went — description and amount, not just an id.
    logActivity({
      groupId: row.group_id,
      expenseId: row.id,
      actorId: user.id,
      action: 'deleted',
      summary: `${row.description} · ${moneyText(row.amount, row.currency)}`,
    });
    broadcast(row.group_id, deviceOf(req));
    send(res, 200, { ok: true });
  },

  'GET /api/sync': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    // Every account has a personal ledger; this is where one gets made. A
    // failure here must not take the whole sync down — shared groups are the
    // more important half of the response.
    try {
      personalGroupFor(user.id);
    } catch (err) {
      console.error('could not ensure personal group:', err?.message ?? err);
    }

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
    // Capped per group: the history is worth carrying in the ordinary sync so
    // it works offline and needs no extra round trip, but an old group should
    // not be able to grow the payload without bound. The cap only limits what
    // is *sent* — nothing is ever removed from the table.
    const activity = [];
    for (const gid of groupIds) {
      const rows = db
        .prepare('SELECT * FROM activity_log WHERE group_id = ? ORDER BY at DESC LIMIT 300')
        .all(gid);
      for (const row of rows) activity.push(activityPayload(row));
    }

    // Everyone the user shares a group with, so the client can render names
    // and avatars without a second round trip. The user is always included —
    // a brand-new account has no groups, and the client still needs to be able
    // to resolve its own name and avatar.
    const people = new Map([[user.id, user]]);
    for (const g of groups) for (const m of g.members) people.set(m.id, m);

    // Friends are people you may share no group with at all, so they have to
    // be added to `people` separately or the client has an id it cannot name.
    const friendIds = db
      .prepare('SELECT friend_id FROM friendships WHERE user_id = ?')
      .all(user.id)
      .map((r) => r.friend_id);
    for (const id of friendIds) {
      if (people.has(id)) continue;
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (row) people.set(id, publicUser(row));
    }

    send(res, 200, {
      ok: true,
      user,
      groups,
      expenses,
      activity,
      friendIds,
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

  /**
   * The public half of the VAPID pair.
   *
   * The browser needs it to create a subscription, and it must be the same key
   * every time — a subscription made against one key cannot be pushed to with
   * another. Unauthenticated because it is public by definition.
   */
  'GET /api/push/key': async (_req, res) =>
    send(res, 200, { ok: true, publicKey: PUSH_KEYS.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const endpoint = String(body.endpoint ?? '');
    const p256dh = String(body.keys?.p256dh ?? '');
    const auth = String(body.keys?.auth ?? '');
    if (!endpoint || !p256dh || !auth) return fail(res, 400, 'Incomplete subscription');

    // REPLACE, not IGNORE: a browser can hand back the same endpoint with
    // rotated keys, and keeping the stale pair means every later push to it
    // fails to decrypt and is dropped silently by the browser.
    db.prepare(
      `INSERT OR REPLACE INTO push_subscriptions
         (endpoint, user_id, p256dh, auth, device_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(endpoint, user.id, p256dh, auth, deviceOf(req), now());
    send(res, 201, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    const endpoint = String(body.endpoint ?? '');
    // Scoped to the caller so one account cannot unsubscribe another's device.
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(
      endpoint,
      user.id
    );
    send(res, 200, { ok: true });
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

/**
 * Push a notification about a new entry to everyone it concerns.
 *
 * The counterpart to `broadcast`: that one wakes a running client so the
 * screen updates, this one reaches a phone with the app closed. Both skip the
 * acting device rather than the acting user, so your laptop still hears about
 * what you added on your phone, but the phone does not notify you about your
 * own tap.
 *
 * Fire-and-forget. A push service being slow or down must never delay, or
 * fail, the request that created the expense.
 */
function notifyNewExpense(groupId, actingDeviceId, expense, actorName) {
  const group = db.prepare('SELECT name, type, currency FROM groups WHERE id = ?').get(groupId);
  // Your own solo spending is not news to you, and it is the one ledger
  // nobody else can see.
  if (!group || group.type === 'personal') return;

  const members = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(groupId)
    .map((r) => r.user_id);
  if (!members.length) return;

  const placeholders = members.map(() => '?').join(',');
  const subs = db
    .prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`)
    .all(...members)
    .filter((s) => !actingDeviceId || s.device_id !== actingDeviceId);
  if (!subs.length) return;

  const money = `${group.currency === 'INR' ? '₹' : ''}${(expense.amount / 100).toFixed(2)}`;
  const payload = expense.is_settlement
    ? {
        title: `${actorName} settled up`,
        // A payback is not spending, and the notification should not imply it
        // is — the wording is the same distinction the app makes on screen.
        body: `${money} paid back in ${group.name}`,
        url: `${PUBLIC_WEB_BASE}/group/${groupId}`,
        tag: `expense-${expense.id}`,
      }
    : {
        title: `${actorName} added an expense`,
        body: `${expense.description} · ${money} in ${group.name}`,
        url: `${PUBLIC_WEB_BASE}/group/${groupId}`,
        tag: `expense-${expense.id}`,
      };

  void (async () => {
    for (const sub of subs) {
      const result = await sendPush(sub, payload, PUSH_KEYS, VAPID_SUBJECT);
      if (result === 'gone') {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    }
  })();
}

httpServer.listen(PORT, HOST, () => {
  console.log(`splitwise-api listening on http://${HOST}:${PORT}  (db: ${DB_PATH})`);
  console.log(`google sign-in: ${googleEnabled() ? 'configured' : 'not configured'}`);
});
