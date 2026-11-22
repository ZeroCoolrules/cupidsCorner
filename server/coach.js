// Paid voice sessions with Cupid, the AI coach.
//
// The coach is a voice agent that members reach by phone. The phone number is
// a paid product, so it lives only in the COACH_PHONE_NUMBER environment
// variable: it is never in the code, the database or the public API. A member
// pays with sparks, and only then does the API return the number together
// with a one-time code. The voice agent asks the caller for that code and
// checks it here before the session starts, so a number that gets passed
// around is useless without a paid code.
//
// Settings (all environment variables):
//   COACH_PHONE_NUMBER    the line members call. Unset = feature off.
//   COACH_SESSION_SPARKS  price of one session in sparks (default 1200)
//   COACH_SESSION_MINUTES length of one session (default 20)
//   COACH_CODE_HOURS      how long a paid code can wait before the call (default 48)
//   COACH_AGENT_SECRET    shared secret the voice agent sends to check codes

import crypto from "node:crypto";
import { db } from "./db.js";

const intEnv = (name, fallback, min, max) => {
  const n = Math.round(Number(process.env[name]));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export const COACH_SESSION_SPARKS = intEnv("COACH_SESSION_SPARKS", 1200, 1, 1_000_000);
export const COACH_SESSION_MINUTES = intEnv("COACH_SESSION_MINUTES", 20, 1, 240);
export const COACH_CODE_HOURS = intEnv("COACH_CODE_HOURS", 48, 1, 24 * 30);

const phoneNumber = () => String(process.env.COACH_PHONE_NUMBER || "").trim();
const agentSecret = () => String(process.env.COACH_AGENT_SECRET || "").trim();
export const isCoachConfigured = () => !!phoneNumber();

export async function initCoach() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS coach_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code         TEXT NOT NULL,
      sparks_spent INTEGER NOT NULL,
      minutes      INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT NOT NULL,
      started_at   TEXT,
      ends_at      TEXT,
      ended_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_coach_sessions_user ON coach_sessions(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_coach_sessions_code ON coach_sessions(code);
  `);
}

// A session is live while it is paid and not finished: either still waiting
// for the call (before expires_at) or in progress (before ends_at).
const LIVE = `
  ended_at IS NULL AND (
    (started_at IS NULL AND expires_at > datetime('now')) OR
    (started_at IS NOT NULL AND ends_at > datetime('now'))
  )`;

const cq = {
  liveForUser: db.prepare(`SELECT * FROM coach_sessions WHERE user_id = ? AND ${LIVE} ORDER BY id DESC LIMIT 1`),
  liveByCode: db.prepare(`SELECT * FROM coach_sessions WHERE code = ? AND ${LIVE} ORDER BY id DESC LIMIT 1`),
  byId: db.prepare("SELECT * FROM coach_sessions WHERE id = ?"),
  insert: db.prepare(`
    INSERT INTO coach_sessions (user_id, code, sparks_spent, minutes, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))
  `),
  // Only the first check of a code starts the clock.
  start: db.prepare(`
    UPDATE coach_sessions
    SET started_at = datetime('now'), ends_at = datetime('now', '+' || ? || ' minutes')
    WHERE id = ? AND started_at IS NULL
  `),
  end: db.prepare("UPDATE coach_sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL"),
  history: db.prepare("SELECT * FROM coach_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 10"),
};

const iso = (t) => (t ? t.replace(" ", "T") + "Z" : null);

// Six digits: easy to say out loud or key in on a phone.
async function newCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    if (!(await cq.liveByCode.get(code))) return code;
  }
  throw new Error("Could not create a session code.");
}

// What the paying member sees. This is the only place the number leaves the server.
function sessionView(s) {
  if (!s) return null;
  const phone = phoneNumber();
  return {
    id: s.id,
    phone,
    phoneHref: `tel:${phone.replace(/[^\d+]/g, "")}`,
    code: s.code,
    minutes: s.minutes,
    status: s.started_at ? "in_progress" : "ready",
    paidAt: iso(s.created_at),
    callBy: iso(s.expires_at),
    startedAt: iso(s.started_at),
    endsAt: iso(s.ends_at),
  };
}

function pastView(s) {
  return {
    id: s.id,
    sparksSpent: s.sparks_spent,
    minutes: s.minutes,
    paidAt: iso(s.created_at),
    startedAt: iso(s.started_at),
    used: !!s.started_at,
  };
}

function secretMatches(given) {
  const want = agentSecret();
  if (!want || !given) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

export function registerCoachRoutes(app, { auth, q, rateLimit }) {
  const offer = () => ({
    available: isCoachConfigured(),
    cost: COACH_SESSION_SPARKS,
    minutes: COACH_SESSION_MINUTES,
    codeHours: COACH_CODE_HOURS,
  });

  // Price and whether the member has a paid session waiting. No number here
  // unless they have paid.
  app.get("/api/coach", auth, async (req, res) => {
    const live = isCoachConfigured() ? await cq.liveForUser.get(req.userId) : null;
    const me = await q.profileById.get(req.userId);
    res.json({
      ...offer(),
      sparks: me.sparks,
      session: sessionView(live),
      history: (await cq.history.all(req.userId)).filter((s) => s.id !== live?.id).map(pastView),
    });
  });

  // Pay for a session. Returns the number and a one-time code.
  app.post("/api/coach/sessions", auth, async (req, res) => {
    if (!isCoachConfigured()) {
      return res.status(503).json({ error: "Coach sessions aren't available yet." });
    }
    // Already paid and not used up: show that one instead of charging twice.
    const existing = await cq.liveForUser.get(req.userId);
    if (existing) {
      return res.json({ session: sessionView(existing), charged: false, sparks: (await q.profileById.get(req.userId)).sparks });
    }
    const cost = COACH_SESSION_SPARKS;
    const me = await q.profileById.get(req.userId);
    if (me.sparks < cost) {
      return res.status(400).json({ error: `Not enough sparks. A coach session costs ${cost}.`, cost, sparks: me.sparks });
    }
    // Atomic: two requests at once can't spend the same sparks twice.
    if ((await q.spendSparks.run(cost, req.userId, cost)).changes === 0) {
      return res.status(400).json({ error: "Not enough sparks.", cost });
    }
    let id;
    try {
      const code = await newCode();
      id = Number((await cq.insert.run(req.userId, code, cost, COACH_SESSION_MINUTES, COACH_CODE_HOURS)).lastInsertRowid);
    } catch (err) {
      // Never keep the sparks if the session couldn't be created.
      await q.addSparks.run(cost, req.userId);
      console.error(err);
      return res.status(500).json({ error: "Couldn't start a session. Your sparks were not spent." });
    }
    res.json({
      session: sessionView(await cq.byId.get(id)),
      charged: true,
      sparks: (await q.profileById.get(req.userId)).sparks,
    });
  });

  // ---- voice agent side -------------------------------------------------
  // The agent sends "Authorization: Bearer <COACH_AGENT_SECRET>".

  const agentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: "Too many checks. Try again in a minute.",
  });
  function agentOnly(req, res, next) {
    if (!agentSecret()) return res.status(503).json({ error: "Coach agent access is not configured." });
    const given = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!secretMatches(given)) return res.status(401).json({ error: "Not authorised." });
    next();
  }
  const cleanCode = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 6);

  // Check the code a caller gives. The first valid check starts the session
  // clock. Checking again during the session stays valid, so a dropped call
  // can be picked back up without paying twice.
  app.post("/api/coach/agent/verify", agentLimiter, agentOnly, async (req, res) => {
    const code = cleanCode(req.body?.code);
    const s = code.length === 6 ? await cq.liveByCode.get(code) : null;
    if (!s) return res.json({ valid: false });
    await cq.start.run(s.minutes, s.id);
    const now = await cq.byId.get(s.id);
    const p = await q.profileById.get(s.user_id);
    const secondsLeft = Math.max(0, Math.round((Date.parse(iso(now.ends_at)) - Date.now()) / 1000));
    res.json({
      valid: true,
      sessionId: now.id,
      resumed: !!s.started_at,
      minutes: now.minutes,
      secondsLeft,
      endsAt: iso(now.ends_at),
      // Enough for the coach to greet the caller and give relevant advice.
      member: p
        ? { firstName: p.display_name, age: p.age, gender: p.gender, lookingFor: p.orientation, city: p.city, bio: p.bio }
        : null,
    });
  });

  // Optional: the agent can close a session when the call is over.
  app.post("/api/coach/agent/end", agentLimiter, agentOnly, async (req, res) => {
    const code = cleanCode(req.body?.code);
    const s = req.body?.sessionId ? await cq.byId.get(Number(req.body.sessionId)) : code ? await cq.liveByCode.get(code) : null;
    if (!s) return res.json({ ended: false });
    res.json({ ended: (await cq.end.run(s.id)).changes > 0 });
  });
}
