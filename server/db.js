// Database layer. Two drivers behind one async API:
//
//   - SQLite (node:sqlite), the default: DB_PATH, a file on disk.
//   - Postgres, when DATABASE_URL is set (e.g. a Supabase project). Needed
//     once several sites share this backend.
//
// Queries are written once, SQLite-style (`?` or `@name` placeholders,
// datetime('now', ...)), and translated for Postgres here. Postgres gets
// datetime() and group_concat() helpers so the same SQL runs on both.
//
//   const row  = await db.prepare("SELECT * FROM users WHERE id = ?").get(id);
//   const rows = await db.prepare("...").all(a, b);
//   const info = await db.prepare("INSERT ...").run({ name });  // { lastInsertRowid, changes }

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL || "";
export const isPostgres = Boolean(DATABASE_URL);

// ---- SQLite --------------------------------------------------------------

async function sqliteDriver() {
  const { DatabaseSync } = await import("node:sqlite");
  const file = process.env.DB_PATH || path.join(__dirname, "data.sqlite");
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  return {
    async get(sql, args) {
      return stmt(sql).get(...args);
    },
    async all(sql, args) {
      return stmt(sql).all(...args);
    },
    async run(sql, args) {
      const info = stmt(sql).run(...args);
      return { lastInsertRowid: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },
    async exec(sql) {
      raw.exec(sql);
    },
    async columns(table) {
      return raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    },
    helpers: "",
    ddl: (sql) => sql,
    // Runs fn(tx) inside BEGIN/COMMIT. SQLite has one connection, so keep
    // transactions to scripts (imports, seeds), not request handlers.
    async transaction(fn, wrap) {
      raw.exec("BEGIN");
      try {
        const result = await fn(wrap(this));
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    async close() {
      raw.close();
    },
  };
}

// ---- Postgres ------------------------------------------------------------

// `?` and `@name` placeholders to $1..$n, skipping quoted strings.
export function toPostgres(sql) {
  let out = "";
  let n = 0;
  const names = [];
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (ch === "?") {
      out += `$${++n}`;
    } else if (ch === "@" && /[A-Za-z_]/.test(sql[i + 1] || "")) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1))[0];
      let idx = names.indexOf(name);
      if (idx === -1) {
        names.push(name);
        idx = names.length - 1;
      }
      out += `$${idx + 1}`;
      i += name.length;
    } else {
      out += ch;
    }
  }
  return { text: out, names };
}

// SQLite's datetime() and group_concat(), so the same SQL runs on Postgres.
// Timestamps stay TEXT in 'YYYY-MM-DD HH:MM:SS' UTC, exactly as SQLite writes them.
const PG_HELPERS = `
  CREATE OR REPLACE FUNCTION datetime(t text) RETURNS text LANGUAGE sql STABLE AS $f$
    SELECT to_char(CASE WHEN t = 'now' THEN (now() AT TIME ZONE 'utc') ELSE t::timestamp END,
                   'YYYY-MM-DD HH24:MI:SS')
  $f$;
  CREATE OR REPLACE FUNCTION datetime(t text, modifier text) RETURNS text LANGUAGE sql STABLE AS $f$
    SELECT to_char(CASE WHEN t = 'now' THEN (now() AT TIME ZONE 'utc') ELSE t::timestamp END
                   + modifier::interval, 'YYYY-MM-DD HH24:MI:SS')
  $f$;
  CREATE OR REPLACE FUNCTION group_concat_step(acc text, v anyelement) RETURNS text
    LANGUAGE sql IMMUTABLE AS $f$ SELECT CASE WHEN acc IS NULL THEN v::text ELSE acc || ',' || v::text END $f$;
  CREATE OR REPLACE AGGREGATE group_concat(anyelement) (SFUNC = group_concat_step, STYPE = text);
`;

async function postgresDriver() {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8: COUNT(*), SUM()
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric: AVG()
  pg.types.setTypeParser(16, (v) => (v === null ? null : v === "t" ? 1 : 0)); // booleans as 0/1, like SQLite
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 10),
    ssl: local || process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });
  const cache = new Map();
  const translate = (sql) => {
    let t = cache.get(sql);
    if (!t) cache.set(sql, (t = toPostgres(sql)));
    return t;
  };
  const make = (conn) => {
    const query = (sql, args) => {
      const t = translate(sql);
      const values = t.names.length ? t.names.map((k) => (args[0] || {})[k]) : args;
      // SQLite binds NaN (e.g. Number("abc") from a bad URL id) as NULL; do the same.
      return conn.query(t.text, values.map((v) => (Number.isNaN(v) ? null : v)));
    };
    return {
      async get(sql, args) {
        return (await query(sql, args)).rows[0];
      },
      async all(sql, args) {
        return (await query(sql, args)).rows;
      },
      async run(sql, args) {
        // Postgres has no lastInsertRowid: ask for the inserted row instead.
        const text =
          /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql) ? `${sql.trimEnd()} RETURNING *` : sql;
        const res = await query(text, args);
        return { lastInsertRowid: res.rows?.[0]?.id, changes: res.rowCount };
      },
      async exec(sql) {
        await conn.query(sql);
      },
      async columns(table) {
        const res = await conn.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
          [table]
        );
        return res.rows.map((r) => r.column_name);
      },
      helpers: PG_HELPERS,
      ddl: (sql) =>
        sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"),
      // Runs fn(tx) on one pooled connection inside BEGIN/COMMIT.
      async transaction(fn, wrap) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(wrap(make(client)));
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  };
  return make(pool);
}

const driver = isPostgres ? await postgresDriver() : await sqliteDriver();

function wrap(d) {
  return {
    prepare(sql) {
    return {
        get: (...args) => d.get(sql, args),
        all: (...args) => d.all(sql, args),
        run: (...args) => d.run(sql, args),
      };
    },
    exec: (sql) => d.exec(sql),
    // CREATE TABLE statements written for SQLite, adapted to the driver.
    schema: (sql) => d.exec(d.ddl(sql)),
    columns: (table) => d.columns(table),
    transaction: (fn) => d.transaction(fn, wrap),
    close: () => d.close(),
  };
}

export const db = wrap(driver);

const SCHEMA = `
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

    -- Photo verification (ported from dreamflirt_network's identity checks).
    -- The selfie lives in a private folder, never under /uploads.
    CREATE TABLE IF NOT EXISTS verifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      selfie_file TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Virtual dates (ported from Bid-Love's date simulator).
    CREATE TABLE IF NOT EXISTS virtual_dates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      partner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scenario_key TEXT NOT NULL,
      score        INTEGER NOT NULL,
      sparks_spent INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Live broadcasts ("Go Live", from the Social Streaming Rooms / DatingPro
    -- live module idea): one host, optional co-hosts, an audience that watches.
    CREATE TABLE IF NOT EXISTS live_streams (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
      gift_sparks  INTEGER NOT NULL DEFAULT 0,
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS live_cohosts (
      stream_id  INTEGER NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (stream_id, user_id)
    );

    -- DatingPro bridge: which cupidsCorner user came from which pg_users row.
    CREATE TABLE IF NOT EXISTS datingpro_links (
      pg_user_id  INTEGER PRIMARY KEY,
      user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      pg_email    TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams(status, id);
    CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_fans_target ON fans(target_id);
    CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_id);
    CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts_sent(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(conversation_id, message_id);
  `;

export async function initDb() {
  if (driver.helpers) await driver.exec(driver.helpers);
  await db.schema(SCHEMA);
  await migrate();
}

// Additive schema changes on tables that already existed before this column
// was introduced. ADD COLUMN keeps existing data intact on both drivers.
async function migrate() {
  const addColumn = async (table, name, ddl) => {
    if (!(await db.columns(table)).includes(name)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  await addColumn("profiles", "photo_url", "photo_url TEXT");
  await addColumn("profiles", "last_seen_at", "last_seen_at TEXT");
  await addColumn("profiles", "last_bonus_at", "last_bonus_at TEXT");
  await addColumn("profiles", "prompts", "prompts TEXT DEFAULT '[]'");
  await addColumn("profiles", "premium_until", "premium_until TEXT");
  await addColumn("conversations", "boosted_until", "boosted_until TEXT");
  await addColumn("profiles", "verified_at", "verified_at TEXT");
  await addColumn("users", "banned_at", "banned_at TEXT");
  await addColumn("users", "ban_reason", "ban_reason TEXT");
  await addColumn("users", "terms_accepted_at", "terms_accepted_at TEXT");
  await addColumn("reports", "resolved_at", "resolved_at TEXT");
  await addColumn("reports", "resolution", "resolution TEXT");
  await addColumn("live_streams", "category", "category TEXT NOT NULL DEFAULT 'Social'");
}

// helper: order a pair deterministically for the matches table
export function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}
