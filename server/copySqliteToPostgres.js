// One-time copy of an existing SQLite database into Postgres, for switching a
// running site over. Reads DB_PATH (SQLite), writes DATABASE_URL (Postgres).
//
//   DB_PATH=/var/data/cupid.db DATABASE_URL=postgres://... npm run copy:sqlite-to-postgres
//
// The Postgres database must be empty (no members yet). Everything is copied
// in one transaction, so a failure leaves it empty again. Uploaded photos stay
// where they are (UPLOADS_DIR); only database rows move.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres database to copy into.");
  process.exit(1);
}
const file = process.env.DB_PATH;
if (!file || !fs.existsSync(file)) {
  console.error("Set DB_PATH to the existing SQLite file (on Render: the DB_PATH of the service).");
  process.exit(1);
}

const { db, initDb } = await import("./db.js"); // DATABASE_URL set, so this is Postgres
const { initBrands } = await import("./brands.js");

// Parents before children, so foreign keys hold at every insert.
const TABLES = [
  "brands", "users", "profiles", "sessions", "swipes", "matches", "conversations",
  "conversation_members", "messages", "ratings", "fans", "gifts_sent", "blocks", "reports",
  "message_reactions", "read_state", "room_bans", "verifications", "virtual_dates",
  "live_streams", "live_cohosts", "datingpro_links",
];

const src = new DatabaseSync(file, { readOnly: true });
const srcTables = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));

await initDb();
await initBrands();

const existing = await db.prepare("SELECT COUNT(*) AS c FROM users").get();
if (existing.c > 0) {
  console.error(`The Postgres database already has ${existing.c} members. Copy into an empty database.`);
  await db.close();
  process.exit(1);
}

const counts = {};
await db.transaction(async (tx) => {
  // initBrands created the default brand; the copy brings the real rows.
  await tx.exec("DELETE FROM brands");
  for (const table of TABLES) {
    if (!srcTables.has(table)) continue;
    const targetCols = new Set(await tx.columns(table));
    const cols = src
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name)
      .filter((c) => targetCols.has(c));
    const insert = tx.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    );
    const rows = src.prepare(`SELECT ${cols.join(", ")} FROM ${table}`).all();
    for (const row of rows) await insert.run(...cols.map((c) => row[c]));
    counts[table] = rows.length;
    // Rows came with their ids; move each identity counter past them.
    if (cols.includes("id")) {
      await tx.exec(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
      );
    }
  }
});

await initBrands(); // backfills brand_id for members copied from before brands existed
for (const [t, n] of Object.entries(counts)) console.log(`${t}: ${n}`);
console.log("Copy complete. Set DATABASE_URL on the service and redeploy.");
src.close();
await db.close();
