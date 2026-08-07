/**
 * Password hashing, sessions and login throttling.
 *
 * scrypt from node:crypto rather than bcrypt: it is memory-hard, built in, and
 * needs no native module. Each hash carries its own random salt and the
 * parameters used, so cost can be raised later without invalidating old rows.
 */
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 60;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MIN = 15;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    // Constant-time: a length-independent early return would leak information.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Session tokens are stored hashed, so a DB leak cannot be replayed as a login. */
export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createSession(db, userId) {
  const { token, hash } = newSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 864e5);
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(hash, userId, now.toISOString(), expires.toISOString());
  return { token, expiresAt: expires.toISOString() };
}

export function userForToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.color_index, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, colorIndex: row.color_index };
}

/**
 * Throttle password guessing per email+IP. Cheap counter rather than a full
 * rate limiter, but enough to make online brute force impractical.
 */
export function checkThrottle(db, key) {
  const row = db.prepare('SELECT count, first_at FROM login_attempts WHERE key = ?').get(key);
  if (!row) return { allowed: true };
  const ageMin = (Date.now() - new Date(row.first_at).getTime()) / 60000;
  if (ageMin > ATTEMPT_WINDOW_MIN) {
    db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
    return { allowed: true };
  }
  if (row.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryInMin: Math.ceil(ATTEMPT_WINDOW_MIN - ageMin) };
  }
  return { allowed: true };
}

export function recordFailure(db, key) {
  const row = db.prepare('SELECT count FROM login_attempts WHERE key = ?').get(key);
  if (row) {
    db.prepare('UPDATE login_attempts SET count = count + 1 WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT INTO login_attempts (key, count, first_at) VALUES (?, 1, ?)').run(
      key,
      new Date().toISOString()
    );
  }
}

export function clearFailures(db, key) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
}
