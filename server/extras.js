// Profile extras: custom profile fields, photo albums with a moderation
// queue, winks, and invite links.
//
// Custom fields: the list of questions ("Height", "Wants children"...) lives
//   in the database, seeded with a starter set. Admins can add, rename, hide
//   and reorder them without a deploy. Members' answers are stored per field.
//
// Photo album: up to ALBUM_MAX extra photos per member. Every album photo
//   starts as "pending" and only shows on the member's profile once an admin
//   approves it. Profile pictures (the main photo) go live right away, as
//   before, and are added to the same queue so an admin can still remove one.
//
// Winks: a one-tap "hello" to another member. Free members get a small daily
//   allowance, Premium members a large one. One wink per person per day.
//
// Invites: every member has a personal code. Someone who joins with it gets
//   welcome sparks, and the inviter is rewarded once that new member's first
//   photo is approved by an admin. Tying the reward to a human check keeps
//   throwaway sign-ups from farming sparks.
//
// Settings (environment variables, all optional):
//   PHOTO_ALBUM_MAX          photos per album (default 12)
//   WINKS_PER_DAY            daily winks for free members (default 5)
//   WINKS_PER_DAY_PREMIUM    daily winks for Premium members (default 50)
//   REFERRAL_REWARD_SPARKS   sparks to the inviter (default 100)
//   REFERRAL_WELCOME_SPARKS  sparks to the new member (default 50)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { PREMIUM_COST_SPARKS, PREMIUM_DAYS } from "./premium.js";

const intEnv = (name, fallback, min, max) => {
  const raw = process.env[name];
  const n = Math.round(Number(raw));
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export const ALBUM_MAX = intEnv("PHOTO_ALBUM_MAX", 12, 1, 50);
export const WINKS_PER_DAY = intEnv("WINKS_PER_DAY", 5, 0, 1000);
export const WINKS_PER_DAY_PREMIUM = intEnv("WINKS_PER_DAY_PREMIUM", 50, 0, 1000);
export const REFERRAL_REWARD_SPARKS = intEnv("REFERRAL_REWARD_SPARKS", 100, 0, 100_000);
export const REFERRAL_WELCOME_SPARKS = intEnv("REFERRAL_WELCOME_SPARKS", 50, 0, 100_000);

const TEXT_MAX = 80;
const CAPTION_MAX = 140;
const FIELD_TYPES = ["select", "text", "number"];

// Starter questions. Sensitive topics (religion, ethnicity, politics, health)
// are left out on purpose; an admin can add what suits their community.
const STARTER_FIELDS = [
  { key: "looking_for", label: "Here for", type: "select", options: ["Something serious", "Dating, open to more", "New friends", "Still figuring it out"] },
  { key: "height_cm", label: "Height (cm)", type: "number", options: { min: 120, max: 230 } },
  { key: "has_children", label: "Children", type: "select", options: ["None", "Yes, at home", "Yes, grown up"] },
  { key: "wants_children", label: "Wants children", type: "select", options: ["Yes", "No", "Open to it", "Not sure yet"] },
  { key: "education", label: "Education", type: "select", options: ["High school", "Trade or technical", "Some college", "Bachelor's", "Graduate degree"] },
  { key: "work", label: "Work", type: "text", options: null },
  { key: "smoking", label: "Smoking", type: "select", options: ["Never", "Socially", "Regularly", "Trying to quit"] },
  { key: "drinking", label: "Drinking", type: "select", options: ["Never", "Socially", "Regularly"] },
  { key: "exercise", label: "Exercise", type: "select", options: ["Most days", "A few times a week", "Now and then", "Rarely"] },
  { key: "pets", label: "Pets", type: "select", options: ["Dog", "Cat", "Both", "Other pets", "None, but like them", "None"] },
  { key: "languages", label: "Languages", type: "text", options: null },
];

export async function initExtras() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS profile_field_defs (
      field_key  TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'text',
      options    TEXT,
      sort       INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_field_values (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      field_key  TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS profile_photos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL DEFAULT 'album',
      url           TEXT NOT NULL,
      caption       TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      reject_reason TEXT,
      reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_profile_photos_user ON profile_photos(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_profile_photos_status ON profile_photos(status, id);

    CREATE TABLE IF NOT EXISTS winks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seen_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_winks_to ON winks(to_id, id);
    CREATE INDEX IF NOT EXISTS idx_winks_from ON winks(from_id, id);

    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      reward      INTEGER NOT NULL DEFAULT 0,
      rewarded_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, id);
  `);

  // Seed the starter questions once, on an empty table only, so a field an
  // admin later deletes or renames is never brought back.
  if (Number((await xq.countDefs.get()).c) === 0) {
    let sort = 0;
    for (const f of STARTER_FIELDS) {
      sort += 10;
      await xq.insertDef.run(f.key, f.label, f.type, f.options ? JSON.stringify(f.options) : null, sort);
    }
  }
}

const xq = {
  countDefs: db.prepare("SELECT COUNT(*) AS c FROM profile_field_defs"),
  insertDef: db.prepare("INSERT INTO profile_field_defs (field_key, label, type, options, sort) VALUES (?, ?, ?, ?, ?)"),
  allDefs: db.prepare("SELECT * FROM profile_field_defs ORDER BY sort, field_key"),
  defByKey: db.prepare("SELECT * FROM profile_field_defs WHERE field_key = ?"),
  updateDef: db.prepare("UPDATE profile_field_defs SET label = ?, options = ?, sort = ?, active = ? WHERE field_key = ?"),
  maxSort: db.prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM profile_field_defs"),

  valuesOf: db.prepare("SELECT field_key, value FROM profile_field_values WHERE user_id = ?"),
  setValue: db.prepare(`
    INSERT INTO profile_field_values (user_id, field_key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, field_key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `),
  clearValue: db.prepare("DELETE FROM profile_field_values WHERE user_id = ? AND field_key = ?"),

  photosOf: db.prepare("SELECT * FROM profile_photos WHERE user_id = ? AND kind = 'album' ORDER BY id"),
  approvedPhotosOf: db.prepare(
    "SELECT * FROM profile_photos WHERE user_id = ? AND kind = 'album' AND status = 'approved' ORDER BY id"
  ),
  // Rejected photos have no file any more, so they don't count toward the limit.
  albumCount: db.prepare(
    "SELECT COUNT(*) AS c FROM profile_photos WHERE user_id = ? AND kind = 'album' AND status <> 'rejected'"
  ),
  allPhotoUrlsOf: db.prepare("SELECT url FROM profile_photos WHERE user_id = ? AND kind = 'album' AND status <> 'rejected'"),
  insertPhoto: db.prepare("INSERT INTO profile_photos (user_id, kind, url, caption, status) VALUES (?, ?, ?, ?, 'pending')"),
  photoById: db.prepare("SELECT * FROM profile_photos WHERE id = ?"),
  deletePhoto: db.prepare("DELETE FROM profile_photos WHERE id = ?"),
  deleteAvatarRows: db.prepare("DELETE FROM profile_photos WHERE user_id = ? AND kind = 'avatar'"),
  queue: db.prepare(`
    SELECT ph.*, p.display_name, p.age, u.username
    FROM profile_photos ph
    JOIN users u ON u.id = ph.user_id
    JOIN profiles p ON p.user_id = ph.user_id
    WHERE ph.status = ? ORDER BY ph.id LIMIT 100
  `),
  queueCount: db.prepare("SELECT COUNT(*) AS c FROM profile_photos WHERE status = 'pending'"),
  decide: db.prepare(`
    UPDATE profile_photos SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `),

  insertWink: db.prepare("INSERT INTO winks (from_id, to_id) VALUES (?, ?)"),
  winkedToday: db.prepare(
    "SELECT id FROM winks WHERE from_id = ? AND to_id = ? AND created_at > datetime('now', '-1 days') LIMIT 1"
  ),
  winksSentToday: db.prepare("SELECT COUNT(*) AS c FROM winks WHERE from_id = ? AND created_at > datetime('now', '-1 days')"),
  // Latest wink per sender, newest first.
  winksReceived: db.prepare(`
    SELECT w.from_id, MAX(w.id) AS id, MAX(w.created_at) AS created_at, COUNT(*) AS times,
           SUM(CASE WHEN w.seen_at IS NULL THEN 1 ELSE 0 END) AS unseen
    FROM winks w JOIN users u ON u.id = w.from_id
    WHERE w.to_id = ? AND u.banned_at IS NULL
    GROUP BY w.from_id ORDER BY MAX(w.id) DESC LIMIT 100
  `),
  unseenWinks: db.prepare(`
    SELECT COUNT(DISTINCT w.from_id) AS c FROM winks w JOIN users u ON u.id = w.from_id
    WHERE w.to_id = ? AND w.seen_at IS NULL AND u.banned_at IS NULL
  `),
  markWinksSeen: db.prepare("UPDATE winks SET seen_at = datetime('now') WHERE to_id = ? AND seen_at IS NULL"),

  codeOf: db.prepare("SELECT code FROM referral_codes WHERE user_id = ?"),
  ownerOfCode: db.prepare("SELECT user_id FROM referral_codes WHERE code = ?"),
  insertCode: db.prepare("INSERT INTO referral_codes (user_id, code) VALUES (?, ?)"),
  insertReferral: db.prepare("INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)"),
  referralOf: db.prepare("SELECT * FROM referrals WHERE referred_id = ?"),
  // Atomic: a reward can only ever be claimed once per invited member.
  claimReward: db.prepare(
    "UPDATE referrals SET rewarded_at = datetime('now'), reward = ? WHERE referred_id = ? AND rewarded_at IS NULL"
  ),
  referralStats: db.prepare(`
    SELECT COUNT(*) AS joined,
           SUM(CASE WHEN rewarded_at IS NOT NULL THEN 1 ELSE 0 END) AS rewarded,
           COALESCE(SUM(reward), 0) AS sparks
    FROM referrals WHERE referrer_id = ?
  `),
};

const iso = (t) => (t ? t.replace(" ", "T") + "Z" : null);
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const parseOptions = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

function defOut(d) {
  return {
    key: d.field_key,
    label: d.label,
    type: d.type,
    options: parseOptions(d.options),
    sort: d.sort,
    active: !!d.active,
  };
}

// Returns the cleaned value, "" to clear the answer, or null when it isn't allowed.
function cleanAnswer(def, raw) {
  const text = clean(raw, TEXT_MAX);
  if (!text) return "";
  const options = parseOptions(def.options);
  if (def.type === "select") return Array.isArray(options) && options.includes(text) ? text : null;
  if (def.type === "number") {
    const n = Math.round(Number(text));
    const min = Number(options?.min ?? -1e9);
    const max = Number(options?.max ?? 1e9);
    return Number.isFinite(n) && n >= min && n <= max ? String(n) : null;
  }
  return text;
}

// Validates what an admin typed for a field's options. Returns JSON text,
// null for "no options", or undefined when it isn't valid for the type.
function cleanOptions(type, raw) {
  if (type === "select") {
    const list = [...new Set((Array.isArray(raw) ? raw : []).map((o) => clean(o, TEXT_MAX)).filter(Boolean))].slice(0, 30);
    return list.length >= 2 ? JSON.stringify(list) : undefined;
  }
  if (type === "number") {
    const min = Number(raw?.min);
    const max = Number(raw?.max);
    if (raw == null || (raw.min == null && raw.max == null)) return null;
    return Number.isFinite(min) && Number.isFinite(max) && min < max ? JSON.stringify({ min, max }) : undefined;
  }
  return null;
}

// The answers shown on a profile: only fields that are still active, in order.
async function answersOf(userId) {
  const values = Object.fromEntries((await xq.valuesOf.all(userId)).map((v) => [v.field_key, v.value]));
  return (await xq.allDefs.all())
    .filter((d) => d.active && values[d.field_key])
    .map((d) => ({ key: d.field_key, label: d.label, value: values[d.field_key] }));
}

function photoOut(p, { own = false } = {}) {
  const out = { id: p.id, url: p.url, caption: p.caption, createdAt: iso(p.created_at) };
  if (own) {
    out.status = p.status;
    out.rejectReason = p.reject_reason || null;
    // A rejected photo's file is gone; don't hand out a dead link.
    if (p.status === "rejected") out.url = null;
  }
  return out;
}

// Files to remove when an account is deleted.
export async function albumPhotosOf(userId) {
  return (await xq.allPhotoUrlsOf.all(userId)).map((r) => r.url);
}

// Called when a member sets a new profile picture: it goes live right away
// and joins the review queue. Only the newest picture is kept in the queue.
export async function trackAvatar(userId, url) {
  await xq.deleteAvatarRows.run(userId);
  if (url) await xq.insertPhoto.run(userId, "avatar", url, "");
}

async function codeFor(userId) {
  const row = await xq.codeOf.get(userId);
  if (row) return row.code;
  for (let i = 0; i < 10; i += 1) {
    // No look-alike characters (0/O, 1/I/L), so a code survives being read out loud.
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const code = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join("");
    if (await xq.ownerOfCode.get(code)) continue;
    try {
      await xq.insertCode.run(userId, code);
      return code;
    } catch {
      // Two requests at once: use whichever code won.
      const again = await xq.codeOf.get(userId);
      if (again) return again.code;
    }
  }
  throw new Error("Could not create an invite code.");
}

const normalizeCode = (raw) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

// Called right after a new account is created. Never blocks a sign-up: a
// missing or unknown code is simply ignored. Returns the welcome sparks given.
export async function applyReferral(newUserId, rawCode, { q }) {
  try {
    const code = normalizeCode(rawCode);
    if (!code) return 0;
    const owner = await xq.ownerOfCode.get(code);
    if (!owner || owner.user_id === newUserId) return 0;
    if ((await q.userById.get(owner.user_id))?.banned_at) return 0;
    await xq.insertReferral.run(owner.user_id, newUserId);
    if (REFERRAL_WELCOME_SPARKS > 0) await q.addSparks.run(REFERRAL_WELCOME_SPARKS, newUserId);
    return REFERRAL_WELCOME_SPARKS;
  } catch (err) {
    console.error("referral not recorded:", err);
    return 0;
  }
}

// Pays the inviter once, the first time one of the invited member's photos is approved.
async function rewardReferrer(referredId, { q }) {
  const ref = await xq.referralOf.get(referredId);
  if (!ref || ref.rewarded_at) return;
  if ((await q.userById.get(ref.referrer_id))?.banned_at) return;
  if ((await xq.claimReward.run(REFERRAL_REWARD_SPARKS, referredId)).changes === 0) return;
  if (REFERRAL_REWARD_SPARKS > 0) await q.addSparks.run(REFERRAL_REWARD_SPARKS, ref.referrer_id);
}

export function registerExtrasRoutes(app, { auth, adminOnly, q, rateLimit, upload, uploadsDir, publicUser }) {
  const removeUpload = (url) => {
    if (url) fs.unlink(path.join(uploadsDir, path.basename(url)), () => {});
  };
  const blocked = async (a, b) => !!(await q.isBlocked.get(a, b, b, a));
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    message: "That's a lot of uploads. Try again in a little while.",
  });
  const winkLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: "Slow down a little and try again in a minute.",
  });

  // ---- custom profile fields ----------------------------------------------

  app.get("/api/profile-fields", auth, async (req, res) => {
    const defs = (await xq.allDefs.all()).filter((d) => d.active).map(defOut);
    const values = Object.fromEntries((await xq.valuesOf.all(req.userId)).map((v) => [v.field_key, v.value]));
    res.json({ fields: defs, values });
  });

  app.put("/api/me/profile-fields", auth, async (req, res) => {
    const incoming = req.body?.values;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "Send your answers as { values: { field: answer } }." });
    }
    const defs = Object.fromEntries((await xq.allDefs.all()).filter((d) => d.active).map((d) => [d.field_key, d]));
    const todo = [];
    for (const [key, raw] of Object.entries(incoming).slice(0, 100)) {
      const def = defs[key];
      if (!def) continue; // unknown or hidden field: ignore it
      const value = cleanAnswer(def, raw);
      if (value === null) return res.status(400).json({ error: `That isn't a valid answer for "${def.label}".` });
      todo.push([key, value]);
    }
    for (const [key, value] of todo) {
      if (value) await xq.setValue.run(req.userId, key, value);
      else await xq.clearValue.run(req.userId, key);
    }
    const values = Object.fromEntries((await xq.valuesOf.all(req.userId)).map((v) => [v.field_key, v.value]));
    res.json({ values });
  });

  app.get("/api/admin/profile-fields", auth, adminOnly, async (req, res) => {
    res.json({ fields: (await xq.allDefs.all()).map(defOut), types: FIELD_TYPES });
  });

  app.post("/api/admin/profile-fields", auth, adminOnly, async (req, res) => {
    const label = clean(req.body?.label, 60);
    const type = FIELD_TYPES.includes(req.body?.type) ? req.body.type : "text";
    if (!label) return res.status(400).json({ error: "Give the field a name." });
    const options = cleanOptions(type, req.body?.options);
    if (options === undefined) {
      return res.status(400).json({
        error: type === "select" ? "A list field needs at least two choices." : "Minimum must be lower than maximum.",
      });
    }
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
    let key = base;
    for (let n = 2; await xq.defByKey.get(key); n += 1) key = `${base}_${n}`;
    await xq.insertDef.run(key, label, type, options, Number((await xq.maxSort.get()).m) + 10);
    res.json({ field: defOut(await xq.defByKey.get(key)) });
  });

  // Rename, re-order, hide or change the choices of a field. The type is
  // fixed once created so existing answers stay meaningful.
  app.put("/api/admin/profile-fields/:key", auth, adminOnly, async (req, res) => {
    const def = await xq.defByKey.get(String(req.params.key));
    if (!def) return res.status(404).json({ error: "No such field." });
    const b = req.body || {};
    const label = b.label !== undefined ? clean(b.label, 60) : def.label;
    if (!label) return res.status(400).json({ error: "Give the field a name." });
    let options = def.options;
    if (b.options !== undefined) {
      options = cleanOptions(def.type, b.options);
      if (options === undefined) {
        return res.status(400).json({
          error: def.type === "select" ? "A list field needs at least two choices." : "Minimum must be lower than maximum.",
        });
      }
    }
    const sort = b.sort !== undefined && Number.isFinite(Number(b.sort)) ? Math.round(Number(b.sort)) : def.sort;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : def.active;
    await xq.updateDef.run(label, options, sort, active, def.field_key);
    res.json({ field: defOut(await xq.defByKey.get(def.field_key)) });
  });

  // ---- photo album ----------------------------------------------------------

  app.get("/api/me/photos", auth, async (req, res) => {
    res.json({
      photos: (await xq.photosOf.all(req.userId)).map((p) => photoOut(p, { own: true })),
      max: ALBUM_MAX,
    });
  });

  app.post("/api/me/photos", auth, uploadLimiter, upload.single("photo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Upload a jpg, png, webp, or gif under 5MB." });
    const url = `/uploads/${req.file.filename}`;
    if (Number((await xq.albumCount.get(req.userId)).c) >= ALBUM_MAX) {
      removeUpload(url);
      return res.status(400).json({ error: `Your album is full (${ALBUM_MAX} photos). Remove one to add another.` });
    }
    const id = Number((await xq.insertPhoto.run(req.userId, "album", url, clean(req.body?.caption, CAPTION_MAX))).lastInsertRowid);
    res.json({ photo: photoOut(await xq.photoById.get(id), { own: true }) });
  });

  app.delete("/api/me/photos/:id", auth, async (req, res) => {
    const photo = await xq.photoById.get(Number(req.params.id));
    if (!photo || photo.user_id !== req.userId || photo.kind !== "album") {
      return res.status(404).json({ error: "No such photo." });
    }
    await xq.deletePhoto.run(photo.id);
    if (photo.status !== "rejected") removeUpload(photo.url);
    res.json({ ok: true });
  });

  // ---- what others see on a profile: answers, album, wink state -------------

  app.get("/api/users/:id/extras", auth, async (req, res) => {
    const id = Number(req.params.id);
    const target = await q.userById.get(id);
    if (!target || (id !== req.userId && target.banned_at)) return res.status(404).json({ error: "no such user" });
    const isSelf = id === req.userId;
    if (!isSelf && (await blocked(req.userId, id))) {
      return res.json({ fields: [], photos: [], wink: { canWink: false, winkedToday: false } });
    }
    res.json({
      fields: await answersOf(id),
      photos: (await xq.approvedPhotosOf.all(id)).map((p) => photoOut(p)),
      wink: {
        canWink: !isSelf,
        winkedToday: !isSelf && !!(await xq.winkedToday.get(req.userId, id)),
      },
    });
  });

  // ---- admin: photo review queue ---------------------------------------------

  app.get("/api/admin/photos", auth, adminOnly, async (req, res) => {
    const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
    const rows = await xq.queue.all(status);
    res.json({
      pending: Number((await xq.queueCount.get()).c),
      photos: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        url: r.status === "rejected" ? null : r.url,
        caption: r.caption,
        status: r.status,
        rejectReason: r.reject_reason || null,
        createdAt: iso(r.created_at),
        reviewedAt: iso(r.reviewed_at),
        user: { id: r.user_id, username: r.username, displayName: r.display_name, age: r.age },
      })),
    });
  });

  app.post("/api/admin/photos/:id/decision", auth, adminOnly, async (req, res) => {
    const photo = await xq.photoById.get(Number(req.params.id));
    if (!photo) return res.status(404).json({ error: "No such photo." });
    const approve = req.body?.approve === true;
    const reason = approve ? null : clean(req.body?.reason, 200) || "Doesn't meet the photo guidelines.";
    if ((await xq.decide.run(approve ? "approved" : "rejected", reason, req.userId, photo.id)).changes === 0) {
      return res.status(409).json({ error: "Someone already reviewed that photo." });
    }
    if (approve) {
      await rewardReferrer(photo.user_id, { q });
    } else {
      if (photo.kind === "avatar") {
        // Take the picture off the profile only if it is still the one in use.
        const profile = await q.profileById.get(photo.user_id);
        if (profile?.photo_url === photo.url) await q.setPhoto.run(null, photo.user_id);
      }
      removeUpload(photo.url);
    }
    res.json({ ok: true, status: approve ? "approved" : "rejected", pending: Number((await xq.queueCount.get()).c) });
  });

  // ---- winks -----------------------------------------------------------------

  const winkAllowance = async (userId) => {
    const premium = !!(await q.isPremium.get(userId))?.active;
    const limit = premium ? WINKS_PER_DAY_PREMIUM : WINKS_PER_DAY;
    const used = Number((await xq.winksSentToday.get(userId)).c);
    return { limit, used, left: Math.max(0, limit - used), premium };
  };

  app.post("/api/users/:id/wink", auth, winkLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.userId) return res.status(400).json({ error: "You can't wink at yourself." });
    const target = await q.userById.get(id);
    if (!target || target.banned_at) return res.status(404).json({ error: "no such user" });
    if (await blocked(req.userId, id)) return res.status(403).json({ error: "unavailable" });
    if (await xq.winkedToday.get(req.userId, id)) {
      return res.status(400).json({ error: "You already winked at them today.", winkedToday: true });
    }
    const allowance = await winkAllowance(req.userId);
    if (allowance.left <= 0) {
      return res.status(429).json({
        error: allowance.premium
          ? "You've used all your winks for today."
          : `You've used today's ${allowance.limit} free winks. Premium members get ${WINKS_PER_DAY_PREMIUM} a day.`,
        ...allowance,
      });
    }
    await xq.insertWink.run(req.userId, id);
    res.json({ ok: true, ...(await winkAllowance(req.userId)) });
  });

  // People who winked at you. Opening the list marks them as seen.
  app.get("/api/winks", auth, async (req, res) => {
    const rows = await xq.winksReceived.all(req.userId);
    const winks = [];
    for (const r of rows) {
      if (await blocked(req.userId, r.from_id)) continue;
      const user = await publicUser(r.from_id);
      if (!user) continue;
      winks.push({
        user: { ...user, sparks: undefined },
        at: iso(r.created_at),
        times: Number(r.times),
        isNew: Number(r.unseen) > 0,
        winkedBackToday: !!(await xq.winkedToday.get(req.userId, r.from_id)),
      });
    }
    await xq.markWinksSeen.run(req.userId);
    res.json({
      winks,
      allowance: await winkAllowance(req.userId),
      limits: { free: WINKS_PER_DAY, premium: WINKS_PER_DAY_PREMIUM },
      premium: { cost: PREMIUM_COST_SPARKS, days: PREMIUM_DAYS },
    });
  });

  app.get("/api/winks/unseen", auth, async (req, res) => {
    res.json({ count: Number((await xq.unseenWinks.get(req.userId)).c) });
  });

  // ---- invites ---------------------------------------------------------------

  app.get("/api/me/referral", auth, async (req, res) => {
    const stats = await xq.referralStats.get(req.userId);
    res.json({
      code: await codeFor(req.userId),
      joined: Number(stats.joined) || 0,
      rewarded: Number(stats.rewarded) || 0,
      sparksEarned: Number(stats.sparks) || 0,
      reward: REFERRAL_REWARD_SPARKS,
      welcome: REFERRAL_WELCOME_SPARKS,
    });
  });

  // Lets the join page say "Sam invited you" before sign-up. First name only.
  app.get("/api/public/referral/:code", async (req, res) => {
    const owner = await xq.ownerOfCode.get(normalizeCode(req.params.code));
    const user = owner && !(await q.userById.get(owner.user_id))?.banned_at ? await q.profileById.get(owner.user_id) : null;
    if (!user) return res.json({ valid: false });
    res.json({ valid: true, inviterName: user.display_name, welcome: REFERRAL_WELCOME_SPARKS });
  });

}
