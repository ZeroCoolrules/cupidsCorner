// The open meetup board.
//
// A member posts a time they're free and what they'd like to do ("Coffee,
// Saturday 2 to 4, around the Pearl District"). Anyone can ask to join. The
// host decides who comes: nobody is added without the host saying yes.
//
// Safety choices, on purpose:
//   - Every member is already 18+ (checked at sign-up), so the board is too.
//   - The board shows only a general area. The exact place is a separate,
//     private field that only the host and the people they accepted can see.
//   - Blocks and bans apply both ways: you never see a meetup from someone you
//     blocked, who blocked you, or who is banned, and they can't ask to join
//     yours.
//   - Reporting a meetup files a normal report against its host, so it lands
//     in the existing admin Reports queue.
//   - When the host accepts someone, a chat opens between the two of them so
//     they can sort out details without swapping phone numbers.
//
// Settings (environment variables, all optional):
//   MEETUPS_ACTIVE_MAX   upcoming meetups one member can have posted (default 3)
//   MEETUP_DAYS_AHEAD    how far ahead a meetup can be posted (default 60)

import { db } from "./db.js";

const intEnv = (name, fallback, min, max) => {
  const raw = process.env[name];
  const n = Math.round(Number(raw));
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export const MEETUPS_ACTIVE_MAX = intEnv("MEETUPS_ACTIVE_MAX", 3, 1, 50);
export const MEETUP_DAYS_AHEAD = intEnv("MEETUP_DAYS_AHEAD", 60, 1, 365);
const SPOTS_MAX = 10;
const HOURS_MAX = 12;
const TITLE_MAX = 80;
const DETAILS_MAX = 600;
const AREA_MAX = 60;
const PLACE_MAX = 200;
const NOTE_MAX = 300;

export async function initMeetups() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS meetups (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      details      TEXT NOT NULL DEFAULT '',
      city         TEXT NOT NULL DEFAULT '',
      area         TEXT NOT NULL DEFAULT '',
      place        TEXT NOT NULL DEFAULT '',
      starts_at    TEXT NOT NULL,
      ends_at      TEXT NOT NULL,
      spots        INTEGER NOT NULL DEFAULT 1,
      cancelled_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_meetups_time ON meetups(ends_at, starts_at);
    CREATE INDEX IF NOT EXISTS idx_meetups_user ON meetups(user_id, id);

    CREATE TABLE IF NOT EXISTS meetup_requests (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      meetup_id  INTEGER NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note       TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'pending',
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (meetup_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_meetup_requests_user ON meetup_requests(user_id, id);
  `);
}

const UPCOMING = "m.cancelled_at IS NULL AND m.ends_at > datetime('now')";

const mq = {
  board: db.prepare(`
    SELECT m.* FROM meetups m JOIN users u ON u.id = m.user_id
    WHERE ${UPCOMING} AND u.banned_at IS NULL
    ORDER BY m.starts_at, m.id LIMIT 200
  `),
  byId: db.prepare("SELECT * FROM meetups WHERE id = ?"),
  hostedBy: db.prepare(`SELECT m.* FROM meetups m WHERE m.user_id = ? AND ${UPCOMING} ORDER BY m.starts_at, m.id`),
  activeCount: db.prepare(`SELECT COUNT(*) AS c FROM meetups m WHERE m.user_id = ? AND ${UPCOMING}`),
  joinedBy: db.prepare(`
    SELECT m.* FROM meetups m JOIN meetup_requests r ON r.meetup_id = m.id
    WHERE r.user_id = ? AND r.status IN ('pending', 'accepted') AND ${UPCOMING}
    ORDER BY m.starts_at, m.id
  `),
  insert: db.prepare(`
    INSERT INTO meetups (user_id, title, details, city, area, place, starts_at, ends_at, spots)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  cancel: db.prepare("UPDATE meetups SET cancelled_at = datetime('now') WHERE id = ? AND cancelled_at IS NULL"),

  requestsFor: db.prepare("SELECT * FROM meetup_requests WHERE meetup_id = ? ORDER BY id"),
  requestById: db.prepare("SELECT * FROM meetup_requests WHERE id = ?"),
  requestOf: db.prepare("SELECT * FROM meetup_requests WHERE meetup_id = ? AND user_id = ?"),
  acceptedCount: db.prepare("SELECT COUNT(*) AS c FROM meetup_requests WHERE meetup_id = ? AND status = 'accepted'"),
  pendingCount: db.prepare("SELECT COUNT(*) AS c FROM meetup_requests WHERE meetup_id = ? AND status = 'pending'"),
  // Asking again after withdrawing re-opens the same row. A declined request stays declined.
  ask: db.prepare(`
    INSERT INTO meetup_requests (meetup_id, user_id, note) VALUES (?, ?, ?)
    ON CONFLICT(meetup_id, user_id) DO UPDATE SET note = excluded.note, status = 'pending', decided_at = NULL
  `),
  setStatus: db.prepare("UPDATE meetup_requests SET status = ?, decided_at = datetime('now') WHERE id = ? AND status = ?"),
  withdraw: db.prepare(`
    UPDATE meetup_requests SET status = 'withdrawn', decided_at = datetime('now')
    WHERE meetup_id = ? AND user_id = ? AND status IN ('pending', 'accepted')
  `),
};

const iso = (t) => (t ? t.replace(" ", "T") + "Z" : null);
const clean = (v, max) => String(v ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const oneLine = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// The database keeps times as UTC "YYYY-MM-DD HH:MM:SS" so they compare with datetime('now').
const toDb = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export function registerMeetupRoutes(app, { auth, q, rateLimit, publicUser, openDm }) {
  const blocked = async (a, b) => !!(await q.isBlocked.get(a, b, b, a));
  const postLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: "You've posted a lot of meetups. Try again in a little while.",
  });
  const joinLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    message: "You've asked to join a lot of meetups. Try again in a little while.",
  });
  const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: "You've sent a lot of reports. Try again later.",
  });

  const person = async (id) => {
    const u = await publicUser(id);
    return u ? { ...u, sparks: undefined } : null;
  };

  // What one member is allowed to see of a meetup.
  async function view(m, meId, { full = false } = {}) {
    const isHost = m.user_id === meId;
    const mine = isHost ? null : await mq.requestOf.get(m.id, meId);
    const accepted = Number((await mq.acceptedCount.get(m.id)).c);
    const out = {
      id: m.id,
      title: m.title,
      details: m.details,
      city: m.city,
      area: m.area,
      startsAt: iso(m.starts_at),
      endsAt: iso(m.ends_at),
      spots: m.spots,
      spotsLeft: Math.max(0, m.spots - accepted),
      cancelled: !!m.cancelled_at,
      isHost,
      host: await person(m.user_id),
      myRequest: mine ? mine.status : null,
      // The exact place is private to the host and the people they accepted.
      place: isHost || mine?.status === "accepted" ? m.place : null,
      hasPlace: !!m.place,
    };
    if (isHost) out.pending = Number((await mq.pendingCount.get(m.id)).c);
    if (full && isHost) {
      out.requests = [];
      for (const r of await mq.requestsFor.all(m.id)) {
        if (r.status === "withdrawn") continue;
        const user = await person(r.user_id);
        if (!user || (await blocked(meId, r.user_id))) continue;
        out.requests.push({ id: r.id, user, note: r.note, status: r.status, askedAt: iso(r.created_at) });
      }
    }
    return out;
  }

  // A meetup the caller may look at, or null (missing, banned host, or blocked).
  async function visible(id, meId) {
    const m = await mq.byId.get(Number(id));
    if (!m) return null;
    if (m.user_id === meId) return m;
    if ((await q.userById.get(m.user_id))?.banned_at) return null;
    if (await blocked(meId, m.user_id)) return null;
    return m;
  }

  // The board: upcoming meetups, soonest first. ?city= narrows it down.
  app.get("/api/meetups", auth, async (req, res) => {
    const city = oneLine(req.query.city, AREA_MAX).toLowerCase();
    const meetups = [];
    for (const m of await mq.board.all()) {
      if (city && !m.city.toLowerCase().includes(city)) continue;
      if (m.user_id !== req.userId && (await blocked(req.userId, m.user_id))) continue;
      meetups.push(await view(m, req.userId));
      if (meetups.length >= 60) break;
    }
    res.json({ meetups, limits: { active: MEETUPS_ACTIVE_MAX, spots: SPOTS_MAX, daysAhead: MEETUP_DAYS_AHEAD, hours: HOURS_MAX } });
  });

  // The ones I'm hosting and the ones I've asked to join.
  app.get("/api/meetups/mine", auth, async (req, res) => {
    const hosting = [];
    for (const m of await mq.hostedBy.all(req.userId)) hosting.push(await view(m, req.userId));
    const joining = [];
    for (const m of await mq.joinedBy.all(req.userId)) {
      if (await visible(m.id, req.userId)) joining.push(await view(m, req.userId));
    }
    res.json({ hosting, joining });
  });

  app.post("/api/meetups", auth, postLimiter, async (req, res) => {
    const b = req.body || {};
    const title = oneLine(b.title, TITLE_MAX);
    const area = oneLine(b.area, AREA_MAX);
    const start = Date.parse(b.startsAt);
    const end = Date.parse(b.endsAt);
    const now = Date.now();
    if (!title) return res.status(400).json({ error: "Say what you'd like to do." });
    if (!area) return res.status(400).json({ error: "Add a general area, like a neighbourhood or part of town." });
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return res.status(400).json({ error: "Pick a start and end time." });
    }
    if (end <= start) return res.status(400).json({ error: "The end time needs to be after the start time." });
    if (end <= now) return res.status(400).json({ error: "That time has already passed." });
    if (end - start > HOURS_MAX * 3600_000) {
      return res.status(400).json({ error: `Keep a meetup to ${HOURS_MAX} hours or less.` });
    }
    if (start > now + MEETUP_DAYS_AHEAD * 86_400_000) {
      return res.status(400).json({ error: `Meetups can be posted up to ${MEETUP_DAYS_AHEAD} days ahead.` });
    }
    if (Number((await mq.activeCount.get(req.userId)).c) >= MEETUPS_ACTIVE_MAX) {
      return res.status(400).json({
        error: `You can have ${MEETUPS_ACTIVE_MAX} meetups posted at a time. Cancel one to post another.`,
      });
    }
    const spots = Math.min(SPOTS_MAX, Math.max(1, Math.round(Number(b.spots)) || 1));
    const profile = await q.profileById.get(req.userId);
    const city = oneLine(b.city, AREA_MAX) || profile?.city || "";
    const info = await mq.insert.run(
      req.userId,
      title,
      clean(b.details, DETAILS_MAX),
      city,
      area,
      oneLine(b.place, PLACE_MAX),
      toDb(start),
      toDb(end),
      spots
    );
    res.json({ meetup: await view(await mq.byId.get(Number(info.lastInsertRowid)), req.userId, { full: true }) });
  });

  app.get("/api/meetups/:id", auth, async (req, res) => {
    const m = await visible(req.params.id, req.userId);
    if (!m) return res.status(404).json({ error: "That meetup isn't available." });
    res.json({ meetup: await view(m, req.userId, { full: true }) });
  });

  // The host calls it off. People who asked to join see it as cancelled.
  app.delete("/api/meetups/:id", auth, async (req, res) => {
    const m = await mq.byId.get(Number(req.params.id));
    if (!m || m.user_id !== req.userId) return res.status(404).json({ error: "That meetup isn't available." });
    await mq.cancel.run(m.id);
    res.json({ ok: true });
  });

  app.post("/api/meetups/:id/join", auth, joinLimiter, async (req, res) => {
    const m = await visible(req.params.id, req.userId);
    if (!m) return res.status(404).json({ error: "That meetup isn't available." });
    if (m.user_id === req.userId) return res.status(400).json({ error: "This is your own meetup." });
    if (m.cancelled_at) return res.status(400).json({ error: "This meetup was cancelled." });
    if (Date.parse(iso(m.ends_at)) <= Date.now()) return res.status(400).json({ error: "This meetup is over." });
    const existing = await mq.requestOf.get(m.id, req.userId);
    if (existing?.status === "pending" || existing?.status === "accepted") {
      return res.json({ ok: true, myRequest: existing.status });
    }
    if (existing?.status === "declined") {
      return res.status(400).json({ error: "The host has already answered your request for this one." });
    }
    if (Number((await mq.acceptedCount.get(m.id)).c) >= m.spots) {
      return res.status(400).json({ error: "This meetup is full." });
    }
    await mq.ask.run(m.id, req.userId, clean(req.body?.note, NOTE_MAX));
    res.json({ ok: true, myRequest: "pending" });
  });

  // Change your mind, before or after the host answers.
  app.delete("/api/meetups/:id/join", auth, async (req, res) => {
    await mq.withdraw.run(Number(req.params.id), req.userId);
    res.json({ ok: true, myRequest: null });
  });

  // The host says yes or no to one request.
  app.post("/api/meetups/:id/requests/:requestId", auth, async (req, res) => {
    const m = await mq.byId.get(Number(req.params.id));
    if (!m || m.user_id !== req.userId) return res.status(404).json({ error: "That meetup isn't available." });
    const r = await mq.requestById.get(Number(req.params.requestId));
    if (!r || r.meetup_id !== m.id) return res.status(404).json({ error: "No such request." });
    const accept = req.body?.accept === true;
    let conversationId = null;
    if (accept) {
      if (m.cancelled_at) return res.status(400).json({ error: "This meetup was cancelled." });
      if (r.status !== "pending") return res.status(409).json({ error: "That request is no longer waiting." });
      if (await blocked(req.userId, r.user_id)) return res.status(403).json({ error: "unavailable" });
      if (Number((await mq.acceptedCount.get(m.id)).c) >= m.spots) {
        return res.status(400).json({ error: "All the spots are taken. Raise the number by posting a new meetup, or decline someone first." });
      }
      if ((await mq.setStatus.run("accepted", r.id, "pending")).changes === 0) {
        return res.status(409).json({ error: "That request is no longer waiting." });
      }
      try {
        conversationId = await openDm(req.userId, r.user_id, `You're meeting up: ${m.title}. Sort out the details here.`);
      } catch (err) {
        console.error("could not open a chat for a meetup:", err);
      }
    } else {
      // Declining also works on someone already accepted (the host changed their mind).
      const from = r.status === "accepted" ? "accepted" : "pending";
      if ((await mq.setStatus.run("declined", r.id, from)).changes === 0) {
        return res.status(409).json({ error: "That request is no longer waiting." });
      }
    }
    res.json({ ok: true, conversationId, meetup: await view(await mq.byId.get(m.id), req.userId, { full: true }) });
  });

  // Goes to the same admin Reports queue as every other report.
  app.post("/api/meetups/:id/report", auth, reportLimiter, async (req, res) => {
    const m = await mq.byId.get(Number(req.params.id));
    if (!m) return res.status(404).json({ error: "That meetup isn't available." });
    if (m.user_id === req.userId) return res.status(400).json({ error: "This is your own meetup." });
    const why = oneLine(req.body?.reason, 300) || "No reason given";
    await q.insertReport.run(req.userId, m.user_id, `Meetup "${m.title}" (#${m.id}): ${why}`.slice(0, 500));
    res.json({ ok: true });
  });
}
