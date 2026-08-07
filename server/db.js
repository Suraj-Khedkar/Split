/**
 * Schema and storage.
 *
 * Uses node:sqlite (built into Node 22+) so the server has zero dependencies —
 * nothing to compile, nothing to keep patched, which matters for something
 * exposed to the public internet via Tailscale Funnel.
 *
 * Money stays in integer minor units here exactly as it does in the app; the
 * two must agree or balances drift.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  // WAL lets reads proceed during writes; without it a slow sync blocks
  // everyone. FK enforcement makes orphaned rows impossible.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      color_index   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS groups (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'other',
      currency   TEXT NOT NULL DEFAULT 'INR',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      code       TEXT PRIMARY KEY,
      group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id            TEXT PRIMARY KEY,
      group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      description   TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'INR',
      category      TEXT NOT NULL DEFAULT 'general',
      split_method  TEXT NOT NULL DEFAULT 'equal',
      date          TEXT NOT NULL,
      notes         TEXT,
      is_settlement INTEGER NOT NULL DEFAULT 0,
      created_by    TEXT NOT NULL REFERENCES users(id),
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      -- Tombstone rather than DELETE: a client that has been offline still
      -- needs to learn the row went away on its next sync.
      deleted       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id, updated_at);

    CREATE TABLE IF NOT EXISTS expense_payers (
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id),
      amount     INTEGER NOT NULL,
      PRIMARY KEY (expense_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id),
      amount     INTEGER NOT NULL,
      PRIMARY KEY (expense_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      key      TEXT PRIMARY KEY,
      count    INTEGER NOT NULL,
      first_at TEXT NOT NULL
    );
  `);

  // --- migrations -------------------------------------------------------
  // CREATE TABLE IF NOT EXISTS never alters an existing table, so new columns
  // have to be added explicitly for databases created by an earlier version.
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columns.includes('placeholder')) {
    // A placeholder is someone named in a group who has no account yet —
    // imported from Splitwise, or simply added by name. They cannot sign in,
    // but expenses can reference them, which the foreign keys require.
    db.exec('ALTER TABLE users ADD COLUMN placeholder INTEGER NOT NULL DEFAULT 0');
  }

  if (!columns.includes('google_sub')) {
    // Google's stable subject id. Accounts are matched on this before email,
    // because a Google account can change its address but never its sub -
    // keying off the address alone would eventually hand someone's account to
    // whoever inherits it.
    db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
    // Partial: almost every row is NULL, and SQLite already treats NULLs as
    // distinct under UNIQUE, so indexing them buys nothing.
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL'
    );
  }

  return db;
}
