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

    -- Append-only trail of everything that has happened to a group's money:
    -- expenses added, edited and deleted, settlements recorded, people joining.
    --
    -- Deliberately carries NO foreign keys, which is the opposite of the rest
    -- of this schema. A trail whose rows vanish when the thing they describe is
    -- removed is not a trail — deleting the group, or hard-deleting an expense,
    -- would take the evidence with it. The ids are stored as plain text so the
    -- record outlives whatever it points at, and the app resolves names for
    -- display at write time instead of joining at read time.
    --
    -- Nothing in the API updates or deletes from this table.
    CREATE TABLE IF NOT EXISTS activity_log (
      id         TEXT PRIMARY KEY,
      group_id   TEXT NOT NULL,
      -- Null for events that are about the group rather than one expense.
      expense_id TEXT,
      actor_id   TEXT NOT NULL,
      -- created | edited | deleted | settled | joined
      action     TEXT NOT NULL,
      at         TEXT NOT NULL,
      -- Human-readable headline, rendered when the event happened.
      summary    TEXT,
      -- JSON array of { field, from, to } for edits; null otherwise.
      detail     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_group ON activity_log(group_id);
    CREATE INDEX IF NOT EXISTS idx_activity_expense ON activity_log(expense_id);

    -- A mutual connection between two accounts.
    --
    -- Stored as two rows, one per direction, rather than one row with an
    -- ordered pair. It costs a few bytes and removes every "did I put the
    -- smaller id first" question from the queries that read it — and being
    -- mutual is the whole point of the feature, so making it structural beats
    -- remembering to check both columns everywhere.
    CREATE TABLE IF NOT EXISTS friendships (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);

    -- Outstanding "click this to prove the address is yours" links.
    --
    -- The token is stored hashed, exactly like a session token: this table is
    -- a set of live credentials, and a leaked copy of it would otherwise let
    -- someone verify as anybody with a pending signup.
    CREATE TABLE IF NOT EXISTS email_verifications (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);

    CREATE TABLE IF NOT EXISTS login_attempts (
      key      TEXT PRIMARY KEY,
      count    INTEGER NOT NULL,
      first_at TEXT NOT NULL
    );

    -- Server-owned values that outlive a restart. Currently just the VAPID
    -- keypair, which cannot be regenerated: every push subscription a browser
    -- has handed out is bound to the public key it was created with.
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      -- The endpoint is the identity of a subscription; a browser that
      -- re-subscribes with the same one is the same install, not a new device.
      endpoint   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      -- Matches the id the client sends as X-Device-Id, so the device that
      -- made a change can be skipped exactly as the WebSocket broadcast does.
      device_id  TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

    -- Native (Android) push, kept apart from the Web Push table above rather
    -- than sharing it. The two have nothing in common: a Web Push subscription
    -- is an endpoint URL plus two encryption keys that this server encrypts
    -- for itself, while this is an opaque Expo token that Expo delivers on our
    -- behalf. Forcing them into one table would mean half the columns are null
    -- in every row and every read has to branch on which kind it is.
    CREATE TABLE IF NOT EXISTS expo_push_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Matches X-Device-Id, so the device that made a change can be skipped
      -- exactly as the WebSocket broadcast and Web Push already do.
      device_id  TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expo_push_user ON expo_push_tokens(user_id);
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

  // A personal ledger is an ordinary group with type 'personal' and exactly one
  // member, so membership checks, sync, live updates and deletion all work
  // unchanged. The alternative — making expenses.group_id nullable — SQLite can
  // only do by rebuilding the table underneath the two foreign keys that
  // reference it, on live data, for no functional gain.
  //
  // The index is what makes "get or create" safe: two syncs racing on first
  // launch would otherwise leave the account with two personal groups and its
  // spending split across both.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_personal
       ON groups(created_by) WHERE type = 'personal'`
  );

  // expense_edits was the edit-only forerunner of activity_log. Move its rows
  // across rather than dropping them: they are exactly the audit history this
  // table exists to preserve, and a deployed server already has some.
  const legacyEdits = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'expense_edits'")
    .get();
  if (legacyEdits) {
    db.exec(
      `INSERT OR IGNORE INTO activity_log (id, group_id, expense_id, actor_id, action, at, summary, detail)
         SELECT id, group_id, expense_id, edited_by, 'edited', edited_at, NULL, changes
           FROM expense_edits`
    );
    db.exec('DROP TABLE expense_edits');
  }

  // Backfill a "created" event for every expense that predates the trail, so
  // the Activity tab is a complete history rather than one that starts the day
  // this shipped. The NOT EXISTS guard makes it idempotent, so it costs one
  // cheap scan on later boots and never double-inserts.
  db.exec(
    `INSERT INTO activity_log (id, group_id, expense_id, actor_id, action, at, summary, detail)
       SELECT lower(hex(randomblob(16))),
              e.group_id,
              e.id,
              e.created_by,
              CASE WHEN e.is_settlement = 1 THEN 'settled' ELSE 'created' END,
              e.created_at,
              e.description || ' · ' || e.currency || ' ' || printf('%.2f', e.amount / 100.0),
              NULL
         FROM expenses e
        WHERE NOT EXISTS (
              SELECT 1 FROM activity_log a
               WHERE a.expense_id = e.id AND a.action IN ('created', 'settled')
        )`
  );

  if (!columns.includes('email_verified')) {
    // Everyone who already has an account is grandfathered in as verified.
    // Defaulting them to 0 would lock every existing user out of their own
    // ledger the moment this deploys, over a check that did not exist when
    // they signed up.
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE users SET email_verified = 1');
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
