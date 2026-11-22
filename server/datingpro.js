// DatingPro bridge — brings members of a PG Dating Pro site (the pg_* schema,
// e.g. Cupid's Point) into cupidsCorner.
//
// Members keep their DatingPro password: Dating Pro stores bcrypt ($2y$)
// hashes, which bcryptjs verifies as-is, so the hash is copied over and they
// sign in with their DatingPro email (or nickname) and the same password.
// Re-running an import is safe: datingpro_links remembers who came from where.
//
// Sources: a live DatingPro MySQL database (DATINGPRO_DATABASE_URL, needs the
// mysql2 package) or a .sql dump exported from phpMyAdmin / mysqldump.

import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const COLUMNS = [
  "id", "email", "nickname", "fname", "user_type", "looking_user_type", "password",
  "is_terms", "approved", "birth_date", "age", "fe_about_me", "is_bot", "is_verified",
];

const COLORS = ["#7d5fff", "#7cc8ff", "#3ec6a0", "#f4a259", "#4dd0e1", "#ff7a9c"];
const EMOJIS = ["💘", "🌹", "✨", "🌙", "🔥", "🦋"];

// ---- reading -------------------------------------------------------------

// Pulls every row of `table` out of a MySQL dump's INSERT statements.
export function rowsFromSqlDump(sql, table = "pg_users") {
  const out = [];
  const head = new RegExp("INSERT INTO `" + table + "` \\(([^)]*)\\) VALUES", "g");
  let m;
  while ((m = head.exec(sql))) {
    const cols = m[1].split(",").map((c) => c.trim().replace(/`/g, ""));
    let i = head.lastIndex;
    // Walk the tuples: (v, v, ...), (...) ... ;
    while (i < sql.length) {
      while (/\s|,/.test(sql[i])) i++;
      if (sql[i] === ";") break;
      if (sql[i] !== "(") break;
      i++;
      const vals = [];
      for (;;) {
        while (sql[i] === " " || sql[i] === "\n" || sql[i] === "\r" || sql[i] === "\t") i++;
        if (sql[i] === "'") {
          let s = "";
          i++;
          for (;;) {
            const ch = sql[i];
            if (ch === "\\") {
              const n = sql[i + 1];
              s += { n: "\n", r: "\r", t: "\t", 0: "\0" }[n] ?? n;
              i += 2;
            } else if (ch === "'" && sql[i + 1] === "'") {
              s += "'";
              i += 2;
            } else if (ch === "'") {
              i++;
              break;
            } else {
              s += ch;
              i++;
            }
          }
          vals.push(s);
        } else {
          let j = i;
          while (sql[j] !== "," && sql[j] !== ")") j++;
          const raw = sql.slice(i, j).trim();
          vals.push(raw.toUpperCase() === "NULL" ? null : Number.isNaN(Number(raw)) ? raw : Number(raw));
          i = j;
        }
        while (sql[i] === " ") i++;
        if (sql[i] === ",") { i++; continue; }
        if (sql[i] === ")") { i++; break; }
        throw new Error(`Couldn't parse the ${table} rows near character ${i}`);
      }
      out.push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
    }
    head.lastIndex = i;
  }
  return out;
}

export function rowsFromSqlFile(file) {
  return rowsFromSqlDump(fs.readFileSync(file, "utf8"));
}

export async function rowsFromMysql(url) {
  let mysql;
  try {
    mysql = await import("mysql2/promise");
  } catch {
    throw new Error("Reading a live DatingPro database needs the mysql2 package: npm install --workspace server mysql2");
  }
  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.query(`SELECT ${COLUMNS.map((c) => "`" + c + "`").join(", ")} FROM pg_users`);
    return rows;
  } finally {
    await conn.end();
  }
}

// ---- mapping -------------------------------------------------------------

const GENDER = { male: "man", female: "woman" };
const LOOKING = { male: "men", female: "women" };

function ageOf(row) {
  const bd = row.birth_date && String(row.birth_date).slice(0, 10);
  if (bd && !bd.startsWith("0000")) {
    const d = new Date(bd + "T00:00:00Z");
    if (!Number.isNaN(d.getTime())) {
      const now = new Date();
      let a = now.getUTCFullYear() - d.getUTCFullYear();
      if (now < new Date(Date.UTC(now.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))) a--;
      return a;
    }
  }
  return Number(row.age) || null;
}

function lookingFor(v) {
  const parts = String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return "everyone";
  return LOOKING[parts[0]] || parts[0] || "";
}

// Maps one pg_users row to what cupidsCorner needs, or returns { skip }.
export function mapDatingProUser(row) {
  if (Number(row.is_bot)) return { skip: "bot account" };
  if (row.approved != null && !Number(row.approved)) return { skip: "not approved on DatingPro" };
  const age = ageOf(row);
  if (!age || age < 18) return { skip: "under 18 or no birth date" };
  const nickname = String(row.nickname || row.fname || "").trim();
  if (!nickname) return { skip: "no nickname" };
  const hash = String(row.password || "");
  const k = Number(row.id) % COLORS.length;
  return {
    pgUserId: Number(row.id),
    email: String(row.email || "").trim().toLowerCase() || null,
    baseUsername: nickname.replace(/[^A-Za-z0-9_.]/g, "").slice(0, 20) || `member${row.id}`,
    displayName: nickname.slice(0, 40),
    age,
    gender: GENDER[row.user_type] || String(row.user_type || ""),
    orientation: lookingFor(row.looking_user_type),
    bio: String(row.fe_about_me || "").slice(0, 500),
    // Dating Pro uses bcrypt; anything else can't be verified here, so those
    // members get an unusable hash and must be given a new password.
    passwordHash: /^\$2[aby]\$\d\d\$/.test(hash) ? hash : bcrypt.hashSync(crypto.randomBytes(18).toString("hex"), 10),
    hasPassword: /^\$2[aby]\$\d\d\$/.test(hash),
    acceptedTerms: !!Number(row.is_terms),
    verified: !!Number(row.is_verified),
    avatarEmoji: EMOJIS[k],
    avatarColor: COLORS[k],
  };
}

// ---- writing -------------------------------------------------------------

// Imports inside one transaction; a dry run rolls it back.
export async function importDatingProUsers(conn, rows, { dryRun = false } = {}) {
  const report = { imported: [], alreadyLinked: 0, skipped: [], needPasswordReset: 0 };
  const DRY_RUN = Symbol("dry run");
  try {
    await conn.transaction(async (db) => {
      await importRows(db, rows, report, dryRun);
      if (dryRun) throw DRY_RUN;
    });
  } catch (err) {
    if (err !== DRY_RUN) throw err;
  }
  return report;
}

async function importRows(db, rows, report, dryRun) {
  const linked = db.prepare("SELECT user_id FROM datingpro_links WHERE pg_user_id = ?");
  const nameTaken = db.prepare("SELECT 1 FROM users WHERE username = ?");
  const insertUser = db.prepare("INSERT INTO users (username, password_hash, terms_accepted_at) VALUES (?, ?, ?)");
  const insertProfile = db.prepare(`
    INSERT INTO profiles (user_id, display_name, age, gender, orientation, bio, avatar_emoji, avatar_color, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertLink = db.prepare("INSERT INTO datingpro_links (pg_user_id, user_id, pg_email) VALUES (?, ?, ?)");

  for (const row of rows) {
    const m = mapDatingProUser(row);
    if (m.skip) {
      report.skipped.push({ pgUserId: Number(row.id), reason: m.skip });
      continue;
    }
    if (await linked.get(m.pgUserId)) {
      report.alreadyLinked++;
      continue;
    }
    let username = m.baseUsername.length >= 3 ? m.baseUsername : `${m.baseUsername}_dp`;
    for (let n = 2; await nameTaken.get(username); n++) username = `${m.baseUsername.slice(0, 20)}${n}`;
    if (!m.hasPassword) report.needPasswordReset++;
    report.imported.push({ pgUserId: m.pgUserId, username });
    if (dryRun) continue;
    const userId = Number(
      (await insertUser.run(username, m.passwordHash, m.acceptedTerms ? new Date().toISOString().slice(0, 19).replace("T", " ") : null))
        .lastInsertRowid
    );
    await insertProfile.run(
      userId, m.displayName, m.age, m.gender, m.orientation, m.bio, m.avatarEmoji, m.avatarColor,
      m.verified ? new Date().toISOString().slice(0, 19).replace("T", " ") : null
    );
    await insertLink.run(m.pgUserId, userId, m.email);
    // The Cupid AI chat is created on first sign-in (ensureAiConversation).
  }
}
