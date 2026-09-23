import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");

export const db = new DatabaseSync(DB_PATH);

export function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      age          INTEGER,
      gender       TEXT,
      orientation  TEXT,
      bio          TEXT DEFAULT '',
      city         TEXT DEFAULT '',
      avatar_emoji TEXT DEFAULT '💘',
      avatar_color TEXT DEFAULT '#7cc8ff',
      interests    TEXT DEFAULT '[]',
      sparks       INTEGER NOT NULL DEFAULT 500,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS swipes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      swiper_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction  TEXT NOT NULL CHECK (direction IN ('like','pass')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (swiper_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_a, user_b)
    );

    -- 'room' = public, discoverable, anyone can join (the Cyber Friends–style webcam room).
    -- 'group' = private, invite-only (members added explicitly, usually from your matches).
    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL CHECK (type IN ('dm','group','room','ai')),
      title      TEXT DEFAULT '',
      topic      TEXT DEFAULT '',
      emoji      TEXT DEFAULT '👥',
      color      TEXT DEFAULT '#8a8aff',
      is_public  INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, user_id)
    );

    -- Local message log. Always used for 'ai' (Cupid) threads. Used for
    -- dm/group/room threads only as a fallback when Stream Chat isn't
    -- configured — see server/streamChat.js.
    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      kind            TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','ai','system','gift')),
      body            TEXT NOT NULL,
      gift_key        TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ratings (
      rater_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ratee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (rater_id, ratee_id)
    );

    CREATE TABLE IF NOT EXISTS fans (
      fan_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (fan_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS gifts_sent (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gift_key        TEXT NOT NULL,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason      TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- fallback-mode only (Stream Chat has native reactions)
    CREATE TABLE IF NOT EXISTS message_reactions (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id      INTEGER NOT NULL,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji           TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, message_id, user_id, emoji)
    );

    -- fallback-mode only (Stream Chat has native read state)
    CREATE TABLE IF NOT EXISTS read_state (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_id    INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, user_id)
    );

    -- People a room's host has banned: they can't rejoin the room or its call.
    CREATE TABLE IF NOT EXISTS room_bans (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      banned_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_fans_target ON fans(target_id);
    CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_id);
    CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts_sent(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(conversation_id, message_id);
  `);

  migrate();
}

// Additive schema changes on tables that already existed before this column
// was introduced. SQLite allows ADD COLUMN on a live table (unlike changing
// a CHECK constraint), so this keeps existing data intact.
function migrate() {
  const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const addColumn = (table, name, ddl) => {
    if (!columnsOf(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  addColumn("profiles", "photo_url", "photo_url TEXT");
  addColumn("profiles", "last_seen_at", "last_seen_at TEXT");
  addColumn("profiles", "last_bonus_at", "last_bonus_at TEXT");
  addColumn("profiles", "prompts", "prompts TEXT DEFAULT '[]'");
  addColumn("profiles", "premium_until", "premium_until TEXT");
  addColumn("conversations", "boosted_until", "boosted_until TEXT");
}

// helper: order a pair deterministically for the matches table
export function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}
