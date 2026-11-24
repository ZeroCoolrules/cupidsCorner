import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { db, initDb, pair } from "./db.js";
import { cupidReply, CUPID_WELCOME } from "./cupid.js";
import {
  isStreamConfigured,
  streamCredentialsFor,
  getOrCreateRoomCall,
  liveRoomStatus,
  moderateRoomCall,
  createLiveCall,
  setLiveCohost,
  endLiveCall,
  liveViewerCounts,
} from "./stream.js";
import {
  syncChannel,
  addChannelMember,
  removeChannelMember,
  sendSystemMessage,
  sendGiftMessage,
  setChannelFrozen,
  ensureLiveChannel,
  sendLiveSystemMessage,
  freezeLiveChannel,
} from "./streamChat.js";
import { GIFT_CATALOG, GIFT_BY_KEY } from "./gifts.js";
import {
  PREMIUM_COST_SPARKS,
  PREMIUM_DAYS,
  ROOM_BOOST_COST_SPARKS,
  ROOM_BOOST_HOURS,
  DAILY_BONUS_SPARKS,
  DAILY_BONUS_COOLDOWN_HOURS,
  PROMPT_BANK,
} from "./premium.js";
import {
  SPARK_PACKS,
  PACK_BY_KEY,
  isBillingConfigured,
  createCheckoutSession,
  constructWebhookEvent,
} from "./billing.js";
import { parseProfiles, compatibility } from "./compat.js";
import { COMPAT_ROUTE, isX402Configured, x402Gate } from "./x402.js";
import { DATE_SCENARIOS, scoreDate, verdictFor } from "./virtualDates.js";
import { scoreCandidate, matchPercent } from "./matching.js";
import {
  initBrands,
  brandMiddleware,
  brandOrigins,
  publicBrand,
  listBrands,
  brandInput,
  createBrand,
  updateBrand,
  DEFAULT_BRAND_SLUG,
} from "./brands.js";
import { initCoach, registerCoachRoutes } from "./coach.js";
import { initPlayBilling, registerPlayBillingRoutes } from "./playBilling.js";
import { initSocial, registerSocialRoutes, feedPhotosOf } from "./social.js";
import { initExtras, registerExtrasRoutes, albumPhotosOf, trackAvatar, applyReferral } from "./extras.js";
import { initMeetups, registerMeetupRoutes } from "./meetups.js";
import { initQuestionnaire, registerQuestionnaireRoutes, quizAnswersOf, quizAnswersFor, compareAnswers } from "./questionnaire.js";
import { initCampaigns, registerCampaignRoutes, applyCampaign } from "./campaigns.js";

// Array helpers for async callbacks (DB calls are async).
const mapAsync = (arr, fn) => Promise.all(arr.map(fn));
async function filterAsync(arr, fn) {
  const keep = await Promise.all(arr.map(fn));
  return arr.filter((_, i) => keep[i]);
}

export const REACTION_EMOJIS = ["❤️", "😂", "👍", "😮", "😢"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
// Both configurable so a Render persistent disk (or any external volume)
// can be pointed at without code changes — see README "Deploy to Render".
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
// Verification selfies are private: never served by express.static. Only
// admins can fetch them, through an authed route.
const verificationsDir = process.env.VERIFICATIONS_DIR || path.join(__dirname, "verifications");
fs.mkdirSync(verificationsDir, { recursive: true });

// Comma-separated usernames allowed to review photo verifications.
const ADMIN_USERNAMES = new Set(
  String(process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean)
);
const MIN_AGE = 18;
const MIN_PASSWORD = 8;
const SESSION_DAYS = 30;
// Public contact for support, privacy and safety requests (shown in Terms/Privacy).
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "";
// Shows the demo-account hint on the login page. Leave off in production.
const DEMO_MODE = process.env.DEMO_MODE === "1";
// Comma-separated origins allowed to call the API cross-origin. The client is
// served from the same origin, so production normally needs none.
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Tiny in-memory fixed-window rate limiter (one process, so this is enough).
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.count += 1;
    if (h.count > max) {
      res.set("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many attempts. Wait a few minutes and try again.",
});
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "You've sent a lot of reports. Try again later.",
});

await initDb();
await initBrands();
await initCoach();
await initPlayBilling();
await initSocial();
await initExtras();
await initMeetups();
await initQuestionnaire();
await initCampaigns();

const app = express();
// Route handlers are async (the database is); pass their errors to the
// error handler at the bottom instead of leaving unhandled rejections.
for (const method of ["get", "post", "put", "patch", "delete", "use"]) {
  const original = app[method].bind(app);
  app[method] = (...args) =>
    original(
      ...args.map((fn) =>
        typeof fn === "function" && fn.length < 4
          ? (req, res, next) => {
              const out = fn(req, res, next);
              if (out && typeof out.catch === "function") out.catch(next);
              return out;
            }
          : fn
      )
    );
}
// Render terminates TLS in front of us; trust it so req.protocol is "https"
// (x402 builds the 402 `resource.url` from it).
app.set("trust proxy", 1);
// Versioned API for separate front ends (the new web site, partner sites):
// /api/v1/... is the same API as /api/..., so the bundled client keeps
// working unchanged while outside sites pin to v1.
app.use((req, res, next) => {
  if (req.url === "/api/v1" || req.url.startsWith("/api/v1/") || req.url.startsWith("/api/v1?")) {
    req.url = "/api" + req.url.slice("/api/v1".length);
  }
  next();
});
app.use(
  cors({
    // Brand domains (see server/brands.js) are allowed alongside ALLOWED_ORIGINS.
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      brandOrigins().then((list) => cb(null, list.includes(origin)), cb);
    },
  })
);
// Basic hardening headers. The React client loads Stream and Stripe from
// their own hosts, so no strict CSP here.
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), payment=(self)",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000");
  next();
});

// Stripe needs the raw, unparsed request body to verify its signature, so
// this route is registered before the global express.json() below.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!isBillingConfigured()) return res.status(503).end();
  let event;
  try {
    event = constructWebhookEvent(req.body, req.get("stripe-signature"));
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = Number(session.metadata?.userId);
    const pack = PACK_BY_KEY[session.metadata?.packKey];
    if (userId && pack) await q.addSparks.run(pack.sparks, userId);
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(brandMiddleware);
app.use("/uploads", express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 5);
      cb(null, `u${req.userId}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

const verificationUpload = multer({
  storage: multer.diskStorage({
    destination: verificationsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 5);
      cb(null, `v${req.userId}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

// Runs a Stream sync call best-effort: never lets a Stream hiccup break the
// core matching/chat flow. No-ops instantly when Stream isn't configured.
async function safeStream(fn) {
  if (!isStreamConfigured()) return;
  try {
    await fn();
  } catch (err) {
    console.warn("[stream] sync failed:", err.message);
  }
}

// In-memory typing indicators (fallback-mode only — ephemeral by design,
// doesn't need to survive a restart). conversationId -> Map(userId -> expiry)
const typingState = new Map();
function markTyping(conversationId, userId) {
  if (!typingState.has(conversationId)) typingState.set(conversationId, new Map());
  typingState.get(conversationId).set(userId, Date.now() + 6000);
}
async function typingNamesFor(conversationId, excludeUserId) {
  const m = typingState.get(conversationId);
  if (!m) return [];
  const now = Date.now();
  const names = [];
  for (const [uid, expiresAt] of m) {
    if (expiresAt < now) {
      m.delete(uid);
      continue;
    }
    if (uid === excludeUserId) continue;
    const p = await q.profileById.get(uid);
    if (p) names.push(p.display_name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const q = {
  userByName: db.prepare("SELECT * FROM users WHERE username = ?"),
  userByDatingProEmail: db.prepare(
    "SELECT u.* FROM users u JOIN datingpro_links d ON d.user_id = u.id WHERE d.pg_email = ?"
  ),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  setUserBrand: db.prepare("UPDATE users SET brand_id = ? WHERE id = ?"),
  insertUser: db.prepare(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)"
  ),
  insertProfile: db.prepare(`
    INSERT INTO profiles (user_id, display_name, age, gender, orientation, bio, city, avatar_emoji, avatar_color, interests)
    VALUES (@user_id, @display_name, @age, @gender, @orientation, @bio, @city, @avatar_emoji, @avatar_color, @interests)
  `),
  profileById: db.prepare("SELECT * FROM profiles WHERE user_id = ?"),
  updateProfile: db.prepare(`
    UPDATE profiles SET display_name=@display_name, age=@age, gender=@gender,
      orientation=@orientation, bio=@bio, city=@city, avatar_emoji=@avatar_emoji,
      avatar_color=@avatar_color, interests=@interests, updated_at=datetime('now')
    WHERE user_id=@user_id
  `),
  addSparks: db.prepare(
    "UPDATE profiles SET sparks = sparks + ? WHERE user_id = ?"
  ),
  insertSession: db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)"),
  sessionByToken: db.prepare(`
    SELECT s.token, s.user_id, u.username, u.banned_at FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.created_at > datetime('now', '-' || ? || ' days')
  `),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE created_at <= datetime('now', '-' || ? || ' days')"),
  acceptTerms: db.prepare("UPDATE users SET terms_accepted_at = datetime('now') WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  banUser: db.prepare("UPDATE users SET banned_at = datetime('now'), ban_reason = ? WHERE id = ?"),
  openReports: db.prepare(`
    SELECT r.*, u.banned_at FROM reports r JOIN users u ON u.id = r.reported_id
    WHERE r.resolved_at IS NULL ORDER BY r.id ASC LIMIT 200
  `),
  resolveReport: db.prepare("UPDATE reports SET resolved_at = datetime('now'), resolution = ? WHERE id = ?"),
  resolveReportsFor: db.prepare(
    "UPDATE reports SET resolved_at = datetime('now'), resolution = ? WHERE reported_id = ? AND resolved_at IS NULL"
  ),
  verificationsFor: db.prepare("SELECT selfie_file FROM verifications WHERE user_id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  insertSwipe: db.prepare(
    "INSERT INTO swipes (swiper_id, target_id, direction) VALUES (?, ?, ?) ON CONFLICT(swiper_id, target_id) DO UPDATE SET direction=excluded.direction"
  ),
  swipeBetween: db.prepare(
    "SELECT * FROM swipes WHERE swiper_id = ? AND target_id = ?"
  ),
  insertMatch: db.prepare(
    "INSERT INTO matches (user_a, user_b) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ),
  matchRow: db.prepare(
    "SELECT * FROM matches WHERE user_a = ? AND user_b = ?"
  ),
  insertConversation: db.prepare(
    "INSERT INTO conversations (type, title, created_by) VALUES (?, ?, ?)"
  ),
  insertRoom: db.prepare(`
    INSERT INTO conversations (type, title, topic, emoji, color, is_public, created_by)
    VALUES ('room', ?, ?, ?, ?, 1, ?)
  `),
  insertMember: db.prepare(
    "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ),
  isRoomBanned: db.prepare("SELECT 1 FROM room_bans WHERE conversation_id = ? AND user_id = ?"),
  addRoomBan: db.prepare(
    "INSERT INTO room_bans (conversation_id, user_id, banned_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
  ),
  removeMember: db.prepare(
    "DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ),
  isMember: db.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
  ),
  memberCount: db.prepare(
    "SELECT COUNT(*) AS c FROM conversation_members WHERE conversation_id = ?"
  ),
  convById: db.prepare("SELECT * FROM conversations WHERE id = ?"),
  membersOf: db.prepare(`
    SELECT p.user_id, p.display_name, p.avatar_emoji, p.avatar_color, p.photo_url,
      (p.premium_until IS NOT NULL AND p.premium_until > datetime('now')) AS is_premium
    FROM conversation_members cm JOIN profiles p ON p.user_id = cm.user_id
    WHERE cm.conversation_id = ?
  `),
  insertMessage: db.prepare(
    "INSERT INTO messages (conversation_id, sender_id, kind, body, gift_key) VALUES (?, ?, ?, ?, ?)"
  ),
  messagesAfter: db.prepare(`
    SELECT m.*, p.display_name AS sender_name, p.avatar_emoji AS sender_emoji, p.avatar_color AS sender_color
    FROM messages m LEFT JOIN profiles p ON p.user_id = m.sender_id
    WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id ASC
  `),
  lastMessage: db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1"
  ),
  myConversations: db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ? ORDER BY c.id DESC
  `),
  dmBetween: db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
    JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
    WHERE c.type = 'dm' LIMIT 1
  `),
  aiConvFor: db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.type = 'ai' AND cm.user_id = ? LIMIT 1
  `),
  ratingSummary: db.prepare(
    "SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE ratee_id = ?"
  ),
  myRating: db.prepare(
    "SELECT stars FROM ratings WHERE rater_id = ? AND ratee_id = ?"
  ),
  upsertRating: db.prepare(`
    INSERT INTO ratings (rater_id, ratee_id, stars) VALUES (?, ?, ?)
    ON CONFLICT(rater_id, ratee_id) DO UPDATE SET stars = excluded.stars, created_at = datetime('now')
  `),
  fanCount: db.prepare("SELECT COUNT(*) AS c FROM fans WHERE target_id = ?"),
  amIFan: db.prepare("SELECT 1 FROM fans WHERE fan_id = ? AND target_id = ?"),
  addFan: db.prepare(
    "INSERT INTO fans (fan_id, target_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ),
  removeFan: db.prepare("DELETE FROM fans WHERE fan_id = ? AND target_id = ?"),
  giftsReceivedCount: db.prepare(
    "SELECT COUNT(*) AS c FROM gifts_sent WHERE recipient_id = ?"
  ),
  giftsReceived: db.prepare(`
    SELECT g.*, p.display_name AS sender_name, p.avatar_emoji AS sender_emoji, p.avatar_color AS sender_color
    FROM gifts_sent g JOIN profiles p ON p.user_id = g.sender_id
    WHERE g.recipient_id = ? ORDER BY g.id DESC LIMIT 30
  `),
  insertGift: db.prepare(
    "INSERT INTO gifts_sent (sender_id, recipient_id, gift_key, conversation_id) VALUES (?, ?, ?, ?)"
  ),
  touchLastSeen: db.prepare("UPDATE profiles SET last_seen_at = datetime('now') WHERE user_id = ?"),
  setPhoto: db.prepare("UPDATE profiles SET photo_url = ? WHERE user_id = ?"),
  updatePrompts: db.prepare("UPDATE profiles SET prompts = ? WHERE user_id = ?"),
  isBlocked: db.prepare(
    "SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)"
  ),
  amIBlocking: db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?"),
  addBlock: db.prepare(
    "INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ),
  removeBlock: db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?"),
  insertReport: db.prepare(
    "INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)"
  ),
  isPremium: db.prepare(
    "SELECT (premium_until IS NOT NULL AND premium_until > datetime('now')) AS active FROM profiles WHERE user_id = ?"
  ),
  extendPremium: db.prepare(`
    UPDATE profiles SET premium_until = datetime(
      CASE WHEN premium_until IS NOT NULL AND premium_until > datetime('now') THEN premium_until ELSE datetime('now') END,
      '+' || ? || ' days'
    ) WHERE user_id = ?
  `),
  extendRoomBoost: db.prepare(`
    UPDATE conversations SET boosted_until = datetime(
      CASE WHEN boosted_until IS NOT NULL AND boosted_until > datetime('now') THEN boosted_until ELSE datetime('now') END,
      '+' || ? || ' hours'
    ) WHERE id = ?
  `),
  bonusEligible: db.prepare(`
    SELECT (last_bonus_at IS NULL OR last_bonus_at <= datetime('now', '-' || ? || ' hours')) AS eligible
    FROM profiles WHERE user_id = ?
  `),
  claimBonus: db.prepare(
    "UPDATE profiles SET sparks = sparks + ?, last_bonus_at = datetime('now') WHERE user_id = ?"
  ),
  likedMeNotBack: db.prepare(`
    SELECT swiper_id FROM swipes
    WHERE target_id = ? AND direction = 'like'
      AND swiper_id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = ?)
      AND swiper_id NOT IN (SELECT id FROM users WHERE banned_at IS NOT NULL)
  `),
  publicRoomsRanked: db.prepare(`
    SELECT *, (boosted_until IS NOT NULL AND boosted_until > datetime('now')) AS is_boosted
    FROM conversations WHERE type = 'room'
    ORDER BY is_boosted DESC, id DESC
  `),
  addReaction: db.prepare(
    "INSERT INTO message_reactions (conversation_id, message_id, user_id, emoji) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING"
  ),
  removeReaction: db.prepare(
    "DELETE FROM message_reactions WHERE conversation_id = ? AND message_id = ? AND user_id = ? AND emoji = ?"
  ),
  hasReaction: db.prepare(
    "SELECT 1 FROM message_reactions WHERE conversation_id = ? AND message_id = ? AND user_id = ? AND emoji = ?"
  ),
  reactionsByConv: db.prepare(`
    SELECT message_id, emoji, COUNT(*) AS c, GROUP_CONCAT(user_id) AS uids
    FROM message_reactions WHERE conversation_id = ? GROUP BY message_id, emoji
  `),
  upsertReadState: db.prepare(`
    INSERT INTO read_state (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET
      last_read_id = CASE WHEN read_state.last_read_id > excluded.last_read_id
        THEN read_state.last_read_id ELSE excluded.last_read_id END, updated_at = datetime('now')
  `),
  readStateAll: db.prepare("SELECT user_id, last_read_id FROM read_state WHERE conversation_id = ?"),
  latestVerification: db.prepare(
    "SELECT * FROM verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1"
  ),
  insertVerification: db.prepare(
    "INSERT INTO verifications (user_id, selfie_file) VALUES (?, ?)"
  ),
  verificationById: db.prepare("SELECT * FROM verifications WHERE id = ?"),
  pendingVerifications: db.prepare(
    "SELECT * FROM verifications WHERE status = 'pending' ORDER BY id ASC LIMIT 50"
  ),
  decideVerification: db.prepare(
    "UPDATE verifications SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
  ),
  setVerifiedAt: db.prepare("UPDATE profiles SET verified_at = ? WHERE user_id = ?"),
  matchBetween: db.prepare("SELECT 1 FROM matches WHERE user_a = ? AND user_b = ?"),
  insertVirtualDate: db.prepare(
    "INSERT INTO virtual_dates (user_id, partner_id, scenario_key, score, sparks_spent) VALUES (?, ?, ?, ?, ?)"
  ),
  spendSparks: db.prepare(
    "UPDATE profiles SET sparks = sparks - ? WHERE user_id = ? AND sparks >= ?"
  ),
};

function isAdmin(username) {
  return ADMIN_USERNAMES.has(String(username || "").toLowerCase());
}

// Returns an error message when `age` is missing or under the minimum.
function ageError(age) {
  const n = Number(age);
  if (!Number.isInteger(n) || n < MIN_AGE || n > 120) {
    return `You must be ${MIN_AGE} or older to use Cupid's Corner.`;
  }
  return null;
}

async function publicUser(userId) {
  const p = await q.profileById.get(userId);
  if (!p) return null;
  return {
    id: userId,
    displayName: p.display_name,
    age: p.age,
    gender: p.gender,
    orientation: p.orientation,
    bio: p.bio,
    city: p.city,
    avatarEmoji: p.avatar_emoji,
    avatarColor: p.avatar_color,
    photoUrl: p.photo_url || null,
    interests: JSON.parse(p.interests || "[]"),
    prompts: JSON.parse(p.prompts || "[]"),
    sparks: p.sparks,
    lastSeenAt: p.last_seen_at,
    premiumUntil: p.premium_until || null,
    isPremium: !!(await q.isPremium.get(userId))?.active,
    isVerified: !!p.verified_at,
  };
}

async function auth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const sess = token && await q.sessionByToken.get(token, SESSION_DAYS);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  if (sess.banned_at) return res.status(403).json({ error: "This account has been suspended." });
  req.userId = sess.user_id;
  req.username = sess.username;
  await q.touchLastSeen.run(req.userId);
  next();
}

async function ensureAiConversation(userId) {
  let row = await q.aiConvFor.get(userId);
  if (row) return row.id;
  const conv = await q.insertConversation.run("ai", "Cupid", null);
  const id = Number(conv.lastInsertRowid);
  await q.insertMember.run(id, userId);
  await q.insertMessage.run(id, null, "ai", CUPID_WELCOME, null);
  return id;
}

// Records a system-style line in both the local fallback log and (if
// configured) the live Stream channel, so it shows up no matter which
// transport the client ends up using.
async function announce(conversationId, text) {
  await q.insertMessage.run(conversationId, null, "system", text, null);
  await safeStream(() => sendSystemMessage(conversationId, text));
}

// ---------------------------------------------------------------------------
// health check (for Render / any platform's uptime probe)
// ---------------------------------------------------------------------------

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// public stats (no auth) — powers the landing page's "presence" strip
// ---------------------------------------------------------------------------

app.get("/api/public/config", (req, res) => {
  res.json({
    supportEmail: req.brand.support_email || SUPPORT_EMAIL,
    demoMode: DEMO_MODE,
    minAge: MIN_AGE,
    brand: publicBrand(req.brand),
  });
});

// The brand this request was matched to (X-Brand header or Host), so a front
// end can theme itself.
app.get("/api/public/brand", (req, res) => {
  res.json(publicBrand(req.brand));
});

app.get("/api/public/stats", async (req, res) => {
  const members = (await db.prepare("SELECT COUNT(*) c FROM users").get()).c;
  const rooms = (await db.prepare("SELECT COUNT(*) c FROM conversations WHERE type='room'").get()).c;
  const matches = (await db.prepare("SELECT COUNT(*) c FROM matches").get()).c;
  const gifts = (await db.prepare("SELECT COUNT(*) c FROM gifts_sent").get()).c;
  res.json({ members, rooms, matches, gifts });
});

// ---------------------------------------------------------------------------
// auth routes
// ---------------------------------------------------------------------------

app.post("/api/auth/signup", authLimiter, async (req, res) => {
  const {
    username,
    password,
    displayName,
    age,
    gender = "",
    orientation = "",
    bio = "",
    city = "",
    avatarEmoji = "💘",
    avatarColor = "#7cc8ff",
    interests = [],
    acceptTerms = false,
  } = req.body || {};

  if (!username || !password || !displayName) {
    return res
      .status(400)
      .json({ error: "username, password and displayName are required" });
  }
  const tooYoung = ageError(age);
  if (tooYoung) return res.status(400).json({ error: tooYoung });
  if (acceptTerms !== true) {
    return res.status(400).json({ error: "Please confirm you're 18+ and agree to the Terms and Privacy Policy." });
  }
  if (!/^[A-Za-z0-9_.]{3,24}$/.test(String(username).trim())) {
    return res.status(400).json({ error: "Usernames are 3-24 letters, numbers, dots or underscores." });
  }
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Passwords need at least ${MIN_PASSWORD} characters.` });
  }
  if (await q.userByName.get(username)) {
    return res.status(409).json({ error: "That username is taken" });
  }

  const hash = bcrypt.hashSync(String(password), 10);
  const info = await q.insertUser.run(String(username).trim(), hash);
  const userId = Number(info.lastInsertRowid);
  await q.setUserBrand.run(req.brand.id, userId);
  await q.acceptTerms.run(userId);
  await q.insertProfile.run({
    user_id: userId,
    display_name: String(displayName).trim(),
    age: Number(age),
    gender: String(gender),
    orientation: String(orientation),
    bio: String(bio),
    city: String(city),
    avatar_emoji: String(avatarEmoji).slice(0, 8) || "💘",
    avatar_color: String(avatarColor),
    interests: JSON.stringify(Array.isArray(interests) ? interests : []),
  });
  await ensureAiConversation(userId);
  // An invite code is optional and never blocks a sign-up.
  const welcomeSparks = await applyReferral(userId, req.body?.referralCode, { q });
  // So is the launch campaign (the state page) they joined through.
  const campaign = await applyCampaign(userId, req.body?.campaign, { q });

  const token = crypto.randomBytes(24).toString("hex");
  await q.insertSession.run(token, userId);
  res.json({ token, user: await publicUser(userId), welcomeSparks, campaign });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const login = String(username || "").trim();
  // Members imported from DatingPro can sign in with their DatingPro email.
  const user =
    login &&
    (await q.userByName.get(login) ||
      (login.includes("@") && await q.userByDatingProEmail.get(login.toLowerCase())));
  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  if (user.banned_at) {
    return res.status(403).json({ error: "This account has been suspended." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  await q.insertSession.run(token, user.id);
  await ensureAiConversation(user.id);
  res.json({ token, user: await publicUser(user.id) });
});

app.post("/api/auth/logout", auth, async (req, res) => {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  await q.deleteSession.run(token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

app.get("/api/me", auth, async (req, res) => {
  res.json({ user: await publicUser(req.userId) });
});

app.put("/api/me", auth, async (req, res) => {
  const cur = await q.profileById.get(req.userId);
  const b = req.body || {};
  if (b.age != null && b.age !== "") {
    const tooYoung = ageError(b.age);
    if (tooYoung) return res.status(400).json({ error: tooYoung });
  }
  await q.updateProfile.run({
    user_id: req.userId,
    display_name: String(b.displayName ?? cur.display_name).trim(),
    age: b.age != null && b.age !== "" ? Number(b.age) : cur.age,
    gender: String(b.gender ?? cur.gender),
    orientation: String(b.orientation ?? cur.orientation),
    bio: String(b.bio ?? cur.bio),
    city: String(b.city ?? cur.city),
    avatar_emoji: String(b.avatarEmoji ?? cur.avatar_emoji).slice(0, 8) || "💘",
    avatar_color: String(b.avatarColor ?? cur.avatar_color),
    interests: JSON.stringify(
      Array.isArray(b.interests)
        ? b.interests
        : JSON.parse(cur.interests || "[]")
    ),
  });
  if (Array.isArray(b.prompts)) {
    const cleaned = b.prompts
      .slice(0, 3)
      .map((p) => ({
        question: String(p?.question || "").slice(0, 140),
        answer: String(p?.answer || "").slice(0, 300),
      }))
      .filter((p) => p.question && p.answer);
    await q.updatePrompts.run(JSON.stringify(cleaned), req.userId);
  }
  res.json({ user: await publicUser(req.userId) });
});

app.post("/api/me/photo", auth, upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Upload a jpg, png, webp, or gif under 5MB." });
  }
  const cur = await q.profileById.get(req.userId);
  if (cur.photo_url) {
    fs.unlink(path.join(uploadsDir, path.basename(cur.photo_url)), () => {});
  }
  await q.setPhoto.run(`/uploads/${req.file.filename}`, req.userId);
  // Live right away, and added to the admin photo review queue.
  await trackAvatar(req.userId, `/uploads/${req.file.filename}`);
  res.json({ user: await publicUser(req.userId) });
});

app.delete("/api/me/photo", auth, async (req, res) => {
  const cur = await q.profileById.get(req.userId);
  if (cur.photo_url) {
    fs.unlink(path.join(uploadsDir, path.basename(cur.photo_url)), () => {});
  }
  await q.setPhoto.run(null, req.userId);
  await trackAvatar(req.userId, null);
  res.json({ user: await publicUser(req.userId) });
});

// Permanently deletes the account and everything that cascades from it
// (profile, swipes, matches, messages, gifts, reports they made...).
app.delete("/api/me", auth, async (req, res) => {
  const user = await q.userById.get(req.userId);
  if (!bcrypt.compareSync(String(req.body?.password || ""), user.password_hash)) {
    return res.status(401).json({ error: "That password isn't right." });
  }
  const profile = await q.profileById.get(req.userId);
  if (profile?.photo_url) fs.unlink(path.join(uploadsDir, path.basename(profile.photo_url)), () => {});
  for (const v of await q.verificationsFor.all(req.userId)) {
    fs.unlink(path.join(verificationsDir, path.basename(v.selfie_file)), () => {});
  }
  for (const url of [...(await feedPhotosOf(req.userId)), ...(await albumPhotosOf(req.userId))]) {
    fs.unlink(path.join(uploadsDir, path.basename(url)), () => {});
  }
  await q.deleteUser.run(req.userId);
  res.json({ ok: true });
});

app.get("/api/prompts/bank", (req, res) => {
  res.json({ bank: PROMPT_BANK });
});

// Public profile: another user's card plus their rating / fan / gift stats.
app.get("/api/users/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const user = await publicUser(id);
  if (!user || (id !== req.userId && (await q.userById.get(id))?.banned_at)) {
    return res.status(404).json({ error: "no such user" });
  }
  const rating = await q.ratingSummary.get(id);
  const mine = await q.myRating.get(req.userId, id);
  res.json({
    user: id === req.userId ? user : { ...user, sparks: undefined },
    isSelf: id === req.userId,
    rating: { average: rating.avg, count: rating.n },
    myRating: mine ? mine.stars : null,
    fans: { count: (await q.fanCount.get(id)).c, amIFan: !!await q.amIFan.get(req.userId, id) },
    gifts: { receivedCount: (await q.giftsReceivedCount.get(id)).c },
    amIBlocking: !!await q.amIBlocking.get(req.userId, id),
  });
});

// Blocking shuts the DM for both people: our routes refuse it (isBlockedDm)
// and the Stream channel is frozen so nobody can post into it directly.
app.post("/api/users/:id/block", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "can't block yourself" });
  if (!await q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  await q.addBlock.run(req.userId, id);
  const dm = await q.dmBetween.get(req.userId, id);
  if (dm) await safeStream(() => setChannelFrozen(dm.id, true));
  res.json({ ok: true, blocked: true });
});

app.delete("/api/users/:id/block", auth, async (req, res) => {
  const id = Number(req.params.id);
  await q.removeBlock.run(req.userId, id);
  // Stay frozen if the other person is still blocking this user.
  const dm = await q.dmBetween.get(req.userId, id);
  if (dm && !await q.isBlocked.get(req.userId, id, id, req.userId)) {
    await safeStream(() => setChannelFrozen(dm.id, false));
  }
  res.json({ ok: true, blocked: false });
});

app.post("/api/users/:id/report", auth, reportLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!await q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  const reason = String(req.body?.reason || "").trim().slice(0, 500) || "No reason given";
  await q.insertReport.run(req.userId, id, reason);
  res.json({ ok: true });
});

// Free users get a count + upgrade prompt; premium unlocks the full list.
app.get("/api/likes", auth, async (req, res) => {
  const rows = await filterAsync(
    await q.likedMeNotBack.all(req.userId, req.userId),
    async (r) => !(await q.isBlocked.get(req.userId, r.swiper_id, r.swiper_id, req.userId))
  );
  const premium = !!(await q.isPremium.get(req.userId))?.active;
  res.json({
    count: rows.length,
    locked: !premium,
    profiles: premium ? await mapAsync(rows, (r) => publicUser(r.swiper_id)) : [],
  });
});

app.post("/api/me/premium", auth, async (req, res) => {
  const me = await q.profileById.get(req.userId);
  if (me.sparks < PREMIUM_COST_SPARKS) {
    return res.status(400).json({ error: `Not enough sparks — Premium costs ${PREMIUM_COST_SPARKS}.` });
  }
  // Atomic: two requests at once can't spend the same sparks twice.
  if ((await q.spendSparks.run(PREMIUM_COST_SPARKS, req.userId, PREMIUM_COST_SPARKS)).changes === 0) {
    return res.status(400).json({ error: "Not enough sparks." });
  }
  await q.extendPremium.run(PREMIUM_DAYS, req.userId);
  res.json({ user: await publicUser(req.userId) });
});

app.post("/api/me/daily-bonus", auth, async (req, res) => {
  const row = await q.bonusEligible.get(DAILY_BONUS_COOLDOWN_HOURS, req.userId);
  if (!row.eligible) {
    return res.json({ claimed: false, sparks: (await q.profileById.get(req.userId)).sparks });
  }
  await q.claimBonus.run(DAILY_BONUS_SPARKS, req.userId);
  res.json({
    claimed: true,
    amount: DAILY_BONUS_SPARKS,
    sparks: (await q.profileById.get(req.userId)).sparks,
  });
});

app.get("/api/users/:id/gifts", auth, async (req, res) => {
  const id = Number(req.params.id);
  const rows = (await q.giftsReceived.all(id)).map((g) => ({
    id: g.id,
    gift: GIFT_BY_KEY[g.gift_key] || { key: g.gift_key, emoji: "🎁", name: g.gift_key },
    sender: { name: g.sender_name, emoji: g.sender_emoji, color: g.sender_color },
    createdAt: g.created_at,
  }));
  res.json({ gifts: rows, total: (await q.giftsReceivedCount.get(id)).c });
});

app.post("/api/users/:id/rating", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "can't rate yourself" });
  if (!await q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  if (await q.isBlocked.get(req.userId, id, id, req.userId)) return res.status(403).json({ error: "unavailable" });
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: "stars must be 1-5" });
  }
  await q.upsertRating.run(req.userId, id, stars);
  const rating = await q.ratingSummary.get(id);
  res.json({ rating: { average: rating.avg, count: rating.n }, myRating: stars });
});

app.post("/api/users/:id/fan", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "can't fan yourself" });
  if (!await q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  if (await q.isBlocked.get(req.userId, id, id, req.userId)) return res.status(403).json({ error: "unavailable" });
  await q.addFan.run(req.userId, id);
  res.json({ fans: { count: (await q.fanCount.get(id)).c, amIFan: true } });
});

app.delete("/api/users/:id/fan", auth, async (req, res) => {
  const id = Number(req.params.id);
  await q.removeFan.run(req.userId, id);
  res.json({ fans: { count: (await q.fanCount.get(id)).c, amIFan: false } });
});

// ---------------------------------------------------------------------------
// gifts
// ---------------------------------------------------------------------------

app.get("/api/gifts/catalog", auth, async (req, res) => {
  res.json({ catalog: GIFT_CATALOG, sparks: (await q.profileById.get(req.userId)).sparks });
});

app.post("/api/gifts/send", auth, async (req, res) => {
  const recipientId = Number(req.body?.recipientId);
  const giftKey = String(req.body?.giftKey || "");
  const conversationId = req.body?.conversationId ? Number(req.body.conversationId) : null;
  const gift = GIFT_BY_KEY[giftKey];

  if (!gift) return res.status(400).json({ error: "unknown gift" });
  if (!recipientId || recipientId === req.userId || !await q.userById.get(recipientId)) {
    return res.status(400).json({ error: "bad recipient" });
  }
  if (await q.isBlocked.get(req.userId, recipientId, recipientId, req.userId)) {
    return res.status(403).json({ error: "unavailable" });
  }
  const me = await q.profileById.get(req.userId);
  if (me.sparks < gift.cost) {
    return res.status(400).json({ error: `Not enough sparks — ${gift.name} costs ${gift.cost}.` });
  }
  if (conversationId && !await q.isMember.get(conversationId, req.userId)) {
    return res.status(403).json({ error: "not a member of that conversation" });
  }

  // Atomic: two requests at once can't spend the same sparks twice.
  if ((await q.spendSparks.run(gift.cost, req.userId, gift.cost)).changes === 0) {
    return res.status(400).json({ error: "Not enough sparks." });
  }
  await q.insertGift.run(req.userId, recipientId, giftKey, conversationId);

  if (conversationId) {
    const text = `${(await publicUser(req.userId)).displayName} sent ${gift.emoji} ${gift.name}`;
    await q.insertMessage.run(conversationId, req.userId, "gift", text, giftKey);
    await safeStream(() => sendGiftMessage(conversationId, req.userId, gift));
  }

  res.json({ ok: true, sparks: (await q.profileById.get(req.userId)).sparks, gift });
});

// ---------------------------------------------------------------------------
// photo verification (ported from dreamflirt_network)
// ---------------------------------------------------------------------------

function verificationView(v) {
  return v ? { id: v.id, status: v.status, createdAt: v.created_at, reviewedAt: v.reviewed_at } : null;
}

app.get("/api/me/verification", auth, async (req, res) => {
  res.json({
    verification: verificationView(await q.latestVerification.get(req.userId)),
    isVerified: !!(await q.profileById.get(req.userId)).verified_at,
    isAdmin: isAdmin(req.username),
  });
});

app.post("/api/me/verification", auth, verificationUpload.single("selfie"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Upload a jpg, png, or webp selfie under 5MB." });
  }
  const latest = await q.latestVerification.get(req.userId);
  if (latest?.status === "pending") {
    fs.unlink(req.file.path, () => {});
    return res.status(409).json({ error: "Your last selfie is still being reviewed." });
  }
  if ((await q.profileById.get(req.userId)).verified_at) {
    fs.unlink(req.file.path, () => {});
    return res.status(409).json({ error: "You're already verified." });
  }
  await q.insertVerification.run(req.userId, req.file.filename);
  res.json({ verification: verificationView(await q.latestVerification.get(req.userId)) });
});

function adminOnly(req, res, next) {
  if (!isAdmin(req.username)) return res.status(403).json({ error: "admins only" });
  next();
}

app.get("/api/admin/verifications", auth, adminOnly, async (req, res) => {
  const items = await mapAsync(await q.pendingVerifications.all(), async (v) => ({
    ...verificationView(v),
    user: await publicUser(v.user_id),
  }));
  res.json({ items });
});

app.get("/api/admin/verifications/:id/selfie", auth, adminOnly, async (req, res) => {
  const v = await q.verificationById.get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: "not found" });
  res.sendFile(path.join(verificationsDir, path.basename(v.selfie_file)));
});

app.get("/api/admin/reports", auth, adminOnly, async (req, res) => {
  const byUser = new Map();
  for (const r of await q.openReports.all()) {
    if (!byUser.has(r.reported_id)) {
      byUser.set(r.reported_id, {
        user: await publicUser(r.reported_id),
        banned: !!r.banned_at,
        reporters: new Set(),
        reports: [],
      });
    }
    const g = byUser.get(r.reported_id);
    g.reporters.add(r.reporter_id);
    g.reports.push({ id: r.id, reason: r.reason, createdAt: r.created_at });
  }
  const items = [...byUser.values()]
    .map((g) => ({ ...g, reporterCount: g.reporters.size, reporters: undefined }))
    .sort((a, b) => b.reporterCount - a.reporterCount);
  res.json({ items });
});

app.post("/api/admin/users/:id/dismiss-reports", auth, adminOnly, async (req, res) => {
  await q.resolveReportsFor.run("dismissed", Number(req.params.id));
  res.json({ ok: true });
});

app.post("/api/admin/users/:id/ban", auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const target = await q.userById.get(id);
  if (!target) return res.status(404).json({ error: "no such user" });
  if (isAdmin(target.username)) return res.status(400).json({ error: "can't ban an admin" });
  await q.banUser.run(String(req.body?.reason || "").slice(0, 300) || "Community guidelines", id);
  await q.deleteUserSessions.run(id);
  await q.resolveReportsFor.run("banned", id);
  res.json({ ok: true });
});

// ---- brands (white-label sites) ---------------------------------------------

app.get("/api/admin/brands", auth, adminOnly, async (req, res) => {
  const counts = Object.fromEntries(
    (await db.prepare("SELECT brand_id, COUNT(*) c FROM users GROUP BY brand_id").all()).map((r) => [r.brand_id, r.c])
  );
  res.json((await listBrands()).map((b) => ({ ...publicBrand(b), active: !!b.active, members: counts[b.id] || 0 })));
});

function brandWriteError(res, err) {
  // SQLite: "UNIQUE constraint failed"; Postgres: code 23505.
  if (err?.code === "23505" || String(err?.message || "").includes("UNIQUE")) {
    return res.status(409).json({ error: "That slug or domain is already used by another brand" });
  }
  throw err;
}

app.post("/api/admin/brands", auth, adminOnly, async (req, res) => {
  const { error, values } = brandInput(req.body, { creating: true });
  if (error) return res.status(400).json({ error });
  try {
    res.status(201).json(publicBrand(await createBrand(values)));
  } catch (err) {
    brandWriteError(res, err);
  }
});

app.put("/api/admin/brands/:slug", auth, adminOnly, async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  if (!await db.prepare("SELECT 1 FROM brands WHERE slug = ?").get(slug)) {
    return res.status(404).json({ error: "no such brand" });
  }
  const { error, values } = brandInput(req.body, { creating: false });
  if (error) return res.status(400).json({ error });
  if (slug === DEFAULT_BRAND_SLUG && (values.slug && values.slug !== slug || values.active === 0)) {
    return res.status(400).json({ error: "The default brand can't be renamed or switched off" });
  }
  try {
    res.json(publicBrand(await updateBrand(slug, values)));
  } catch (err) {
    brandWriteError(res, err);
  }
});

app.post("/api/admin/verifications/:id/decision", auth, adminOnly, async (req, res) => {
  const v = await q.verificationById.get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: "not found" });
  if (v.status !== "pending") return res.status(409).json({ error: "already decided" });
  const approve = req.body?.approve === true;
  await q.decideVerification.run(approve ? "approved" : "rejected", req.userId, v.id);
  if (approve) await q.setVerifiedAt.run(new Date().toISOString(), v.user_id);
  // The selfie is only needed for review; don't keep it afterwards.
  fs.unlink(path.join(verificationsDir, path.basename(v.selfie_file)), () => {});
  res.json({ ok: true, status: approve ? "approved" : "rejected" });
});

// ---------------------------------------------------------------------------
// virtual dates (ported from Bid-Love)
// ---------------------------------------------------------------------------

app.get("/api/dates/scenarios", auth, async (req, res) => {
  res.json({ scenarios: DATE_SCENARIOS, sparks: (await q.profileById.get(req.userId)).sparks });
});

app.post("/api/dates", auth, async (req, res) => {
  const partnerId = Number(req.body?.partnerId);
  if (!partnerId || partnerId === req.userId || !await q.userById.get(partnerId)) {
    return res.status(400).json({ error: "bad partner" });
  }
  if (!await q.matchBetween.get(...pair(req.userId, partnerId))) {
    return res.status(403).json({ error: "You can only go on virtual dates with your matches." });
  }
  if (await q.isBlocked.get(req.userId, partnerId, partnerId, req.userId)) {
    return res.status(403).json({ error: "unavailable" });
  }
  let outcome;
  try {
    outcome = scoreDate(String(req.body?.scenarioKey || ""), req.body?.choices);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { scenario, score, cost } = outcome;
  if (cost > 0 && (await q.spendSparks.run(cost, req.userId, cost)).changes === 0) {
    return res.status(400).json({ error: `Not enough sparks — this date costs ${cost}.` });
  }
  await q.insertVirtualDate.run(req.userId, partnerId, scenario.key, score, cost);

  const verdict = verdictFor(score);
  const dm = await q.dmBetween.get(req.userId, partnerId);
  if (dm) {
    const me = (await publicUser(req.userId)).displayName;
    await announce(dm.id, `${scenario.emoji} ${me} took you on a virtual date at the ${scenario.title}: ${score}% chemistry. ${verdict}!`);
  }
  res.json({
    score,
    verdict,
    sparksSpent: cost,
    sparks: (await q.profileById.get(req.userId)).sparks,
    conversationId: dm ? dm.id : null,
  });
});

// ---------------------------------------------------------------------------
// discovery + swiping
// ---------------------------------------------------------------------------

app.get("/api/discover", auth, async (req, res) => {
  const clauses = [
    "p.user_id != ?",
    "p.user_id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = ?)",
    "p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)",
    "p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)",
    "u.banned_at IS NULL",
  ];
  const params = [req.userId, req.userId, req.userId, req.userId];

  const minAge = Number(req.query.minAge);
  if (Number.isFinite(minAge) && minAge > 0) {
    clauses.push("p.age >= ?");
    params.push(minAge);
  }
  const maxAge = Number(req.query.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    clauses.push("p.age <= ?");
    params.push(maxAge);
  }
  const interest = String(req.query.interest || "").trim().slice(0, 60);
  if (interest) {
    clauses.push("LOWER(p.interests) LIKE LOWER(?)");
    params.push(`%${interest}%`);
  }
  if (req.query.sameCity === "1") {
    const me = await q.profileById.get(req.userId);
    if (me.city) {
      clauses.push("p.city = ?");
      params.push(me.city);
    }
  }

  // Pull a wide pool, then rank it in JS (see server/matching.js).
  const me = await q.profileById.get(req.userId);
  const pool = await db
    .prepare(
      `SELECT p.*, u.created_at,
         (p.premium_until IS NOT NULL AND p.premium_until > datetime('now')) AS is_premium,
         EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = p.user_id AND s.target_id = ? AND s.direction = 'like') AS liked_me,
         (SELECT COUNT(DISTINCT r.reporter_id) FROM reports r WHERE r.reported_id = p.user_id) AS report_count
       FROM profiles p JOIN users u ON u.id = p.user_id
       WHERE ${clauses.join(" AND ")}
       LIMIT 300`
    )
    .all(req.userId, ...params);

  // Questionnaire fit, for candidates who share enough answers with me.
  const myQuiz = await quizAnswersOf(req.userId);
  const poolQuiz = Object.keys(myQuiz).length ? await quizAnswersFor(pool.map((c) => c.user_id)) : new Map();
  const quizFit = (c) => {
    const theirs = poolQuiz.get(Number(c.user_id));
    const fit = theirs ? compareAnswers(myQuiz, theirs) : null;
    return fit?.ready ? fit : null;
  };

  const ranked = pool
    .map((c) => ({ c, s: scoreCandidate(me, c, Math.random, quizFit(c)) }))
    .filter((x) => x.s)
    .sort((a, b) => b.s.score - a.s.score)
    .slice(0, 25);

  res.json({
    profiles: await mapAsync(ranked, async ({ c, s }) => ({
      ...(await publicUser(c.user_id)),
      match: { percent: matchPercent(s.score), reasons: s.reasons, quizPercent: s.quizPercent ?? null },
    })),
  });
});

app.post("/api/swipe", auth, async (req, res) => {
  const targetId = Number(req.body?.targetId);
  const direction = req.body?.direction === "like" ? "like" : "pass";
  if (!targetId || targetId === req.userId || !await q.userById.get(targetId)) {
    return res.status(400).json({ error: "bad target" });
  }
  if (await q.isBlocked.get(req.userId, targetId, targetId, req.userId)) {
    return res.status(403).json({ error: "unavailable" });
  }
  await q.insertSwipe.run(req.userId, targetId, direction);

  let matched = false;
  let conversationId = null;
  if (direction === "like") {
    const back = await q.swipeBetween.get(targetId, req.userId);
    if (back && back.direction === "like") {
      const [a, b] = pair(req.userId, targetId);
      await q.insertMatch.run(a, b);
      matched = true;
      // create the DM conversation for the match if missing
      const existing = await q.dmBetween.get(req.userId, targetId);
      if (existing) {
        conversationId = existing.id;
      } else {
        const conv = await q.insertConversation.run("dm", "", req.userId);
        conversationId = Number(conv.lastInsertRowid);
        await q.insertMember.run(conversationId, req.userId);
        await q.insertMember.run(conversationId, targetId);
        await q.insertMessage.run(conversationId, null, "system", "You matched! Say hello 👋", null);
        await safeStream(async () =>
          syncChannel({
            conversationId,
            type: "dm",
            title: "",
            members: await q.membersOf.all(conversationId),
            createdById: req.userId,
          })
        );
        await safeStream(() => sendSystemMessage(conversationId, "You matched! Say hello 👋"));
      }
    }
  }
  res.json({ matched, conversationId, target: await publicUser(targetId) });
});

app.get("/api/matches", auth, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS other, created_at
       FROM matches WHERE user_a = ? OR user_b = ? ORDER BY id DESC`
    )
    .all(req.userId, req.userId, req.userId);
  const matches = await mapAsync(rows, async (r) => {
    const dm = await q.dmBetween.get(req.userId, r.other);
    return {
      user: await publicUser(r.other),
      matchedAt: r.created_at,
      conversationId: dm ? dm.id : null,
    };
  });
  res.json({ matches });
});

// ---------------------------------------------------------------------------
// conversations + messaging
// ---------------------------------------------------------------------------

// True when `conversationId` is a DM and either side has blocked the other.
async function isBlockedDm(conversationId, meId) {
  const conv = await q.convById.get(conversationId);
  if (conv?.type !== "dm") return false;
  const other = (await q.membersOf.all(conversationId)).find((m) => m.user_id !== meId);
  return !!other && !!await q.isBlocked.get(meId, other.user_id, other.user_id, meId);
}

async function conversationView(conv, meId) {
  const members = await q.membersOf.all(conv.id);
  const last = await q.lastMessage.get(conv.id);
  let title = conv.title;
  let emoji = conv.emoji || "💬";
  let color = conv.color || "#8a8aff";
  let photoUrl = null;
  let isPremium = false;
  if (conv.type === "dm") {
    const other = members.find((m) => m.user_id !== meId) || members[0];
    title = other ? other.display_name : "Direct message";
    emoji = other ? other.avatar_emoji : "💬";
    color = other ? other.avatar_color : color;
    photoUrl = other?.photo_url || null;
    isPremium = !!other?.is_premium;
  } else if (conv.type === "ai") {
    title = "Cupid";
    emoji = "💘";
    color = "#3aa0e8";
  } else if (conv.type === "group") {
    title = conv.title || "Group chat";
  } else if (conv.type === "room") {
    title = conv.title || "Room";
  }
  return {
    id: conv.id,
    type: conv.type,
    title,
    topic: conv.topic || "",
    emoji,
    color,
    photoUrl,
    isPremium,
    isPublic: !!conv.is_public,
    createdById: conv.created_by ?? null,
    members: members.map((m) => ({
      id: m.user_id,
      displayName: m.display_name,
      avatarEmoji: m.avatar_emoji,
      avatarColor: m.avatar_color,
      photoUrl: m.photo_url,
      isPremium: !!m.is_premium,
    })),
    lastMessage: last
      ? { body: last.body, kind: last.kind, createdAt: last.created_at }
      : null,
  };
}

app.get("/api/conversations", auth, async (req, res) => {
  const rows = await q.myConversations.all(req.userId);
  const views = await mapAsync(rows, (c) => conversationView(c, req.userId));
  const list = (
    await filterAsync(views, async (c) => {
      if (c.type !== "dm") return true;
      const other = c.members.find((m) => m.id !== req.userId);
      return !other || !(await q.isBlocked.get(req.userId, other.id, other.id, req.userId));
    })
  ).sort((a, b) => {
      // AI pinned first, then by recency of last message id-ish (keep DB order otherwise)
      if (a.type === "ai") return -1;
      if (b.type === "ai") return 1;
      return 0;
    });
  res.json({ conversations: list });
});

app.get("/api/conversations/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || !await q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (await isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  res.json({ conversation: await conversationView(conv, req.userId) });
});

app.post("/api/conversations/group", auth, async (req, res) => {
  const title = String(req.body?.title || "").trim() || "Group chat";
  const memberIds = Array.isArray(req.body?.memberIds)
    ? [...new Set(req.body.memberIds.map(Number).filter(Boolean))]
    : [];
  const conv = await q.insertConversation.run("group", title, req.userId);
  const id = Number(conv.lastInsertRowid);
  await q.insertMember.run(id, req.userId);
  for (const m of memberIds) {
    if (m !== req.userId && await q.userById.get(m)) await q.insertMember.run(id, m);
  }
  await safeStream(async () =>
    syncChannel({
      conversationId: id,
      type: "group",
      title,
      members: await q.membersOf.all(id),
      createdById: req.userId,
    })
  );
  await announce(id, `${(await publicUser(req.userId)).displayName} started the group.`);
  res.json({ conversation: await conversationView(await q.convById.get(id), req.userId) });
});

app.post("/api/conversations/:id/members", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || conv.type !== "group") return res.status(404).json({ error: "no group" });
  if (!await q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  const userId = Number(req.body?.userId);
  if (!userId || !await q.userById.get(userId)) return res.status(400).json({ error: "bad user" });
  await q.insertMember.run(id, userId);
  const p = await q.profileById.get(userId);
  await safeStream(async () => addChannelMember(id, (await q.membersOf.all(id)).find((m) => m.user_id === userId)));
  await announce(id, `${p.display_name} was added.`);
  res.json({ conversation: await conversationView(await q.convById.get(id), req.userId) });
});

app.post("/api/conversations/:id/leave", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || (conv.type !== "group" && conv.type !== "room")) {
    return res.status(400).json({ error: "can't leave this conversation" });
  }
  if (!await q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  const me = await publicUser(req.userId);
  await q.removeMember.run(id, req.userId);
  await safeStream(() => removeChannelMember(id, req.userId));
  if ((await q.memberCount.get(id)).c > 0) {
    await announce(id, `${me.displayName} left.`);
  }
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!await q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (await isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  const after = Number(req.query.after || 0);

  const reactionRows = await q.reactionsByConv.all(id);
  const reactionsByMessage = new Map();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.message_id) || [];
    list.push({
      emoji: r.emoji,
      count: r.c,
      mine: String(r.uids).split(",").includes(String(req.userId)),
    });
    reactionsByMessage.set(r.message_id, list);
  }

  const messages = (await q.messagesAfter.all(id, after)).map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    senderName: m.kind === "ai" ? "Cupid" : m.sender_name,
    senderEmoji: m.kind === "ai" ? "💘" : m.sender_emoji,
    senderColor: m.kind === "ai" ? "#3aa0e8" : m.sender_color,
    kind: m.kind,
    body: m.body,
    gift: m.gift_key ? GIFT_BY_KEY[m.gift_key] || null : null,
    createdAt: m.created_at,
    mine: m.sender_id === req.userId,
    reactions: reactionsByMessage.get(m.id) || [],
  }));

  const latest = await q.lastMessage.get(id);
  if (latest) await q.upsertReadState.run(id, req.userId, latest.id);

  res.json({
    messages,
    conversation: await conversationView(await q.convById.get(id), req.userId),
    typing: await typingNamesFor(id, req.userId),
    reads: await q.readStateAll.all(id),
  });
});

app.post("/api/conversations/:id/typing", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!await q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (await isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  markTyping(id, req.userId);
  res.json({ ok: true });
});

app.post("/api/conversations/:id/messages/:messageId/react", auth, async (req, res) => {
  const id = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!await q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (await isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  const emoji = String(req.body?.emoji || "");
  if (!REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: "unknown reaction" });

  if (await q.hasReaction.get(id, messageId, req.userId, emoji)) {
    await q.removeReaction.run(id, messageId, req.userId, emoji);
  } else {
    await q.addReaction.run(id, messageId, req.userId, emoji);
  }
  const mine = new Set(
    (await db
      .prepare("SELECT emoji FROM message_reactions WHERE conversation_id=? AND message_id=? AND user_id=?")
      .all(id, messageId, req.userId))
      .map((r) => r.emoji)
  );
  const all = await db
    .prepare(
      "SELECT emoji, COUNT(*) AS c FROM message_reactions WHERE conversation_id=? AND message_id=? GROUP BY emoji"
    )
    .all(id, messageId);
  res.json({ reactions: all.map((r) => ({ emoji: r.emoji, count: r.c, mine: mine.has(r.emoji) })) });
});

app.post("/api/conversations/:id/messages", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || !await q.isMember.get(id, req.userId))
    return res.status(403).json({ error: "not a member" });
  if (await isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "empty message" });
  if (body.length > 4000) return res.status(400).json({ error: "message too long" });

  const info = await q.insertMessage.run(id, req.userId, "text", body, null);
  const created = { id: Number(info.lastInsertRowid) };

  if (conv.type === "ai") {
    const history = await db
      .prepare(
        "SELECT kind, body FROM messages WHERE conversation_id = ? ORDER BY id ASC"
      )
      .all(id);
    let reply;
    try {
      reply = await cupidReply(body, history);
    } catch {
      reply = "My bow's a little tangled — try me again in a sec. 💘";
    }
    await q.insertMessage.run(id, null, "ai", reply, null);
  }

  res.json({ ok: true, id: created.id });
});

// ---------------------------------------------------------------------------
// public rooms — Cyber Friends–style, browsable, no match required to join
// ---------------------------------------------------------------------------

app.get("/api/rooms", auth, async (req, res) => {
  const convs = await q.publicRoomsRanked.all();
  let live = {};
  if (isStreamConfigured()) {
    try {
      live = await liveRoomStatus(convs.map((c) => c.id));
    } catch (err) {
      console.warn("[stream] live room status failed:", err.message);
    }
  }
  const rows = await mapAsync(convs, async (c) => ({
    ...(await conversationView(c, req.userId)),
    memberCount: (await q.memberCount.get(c.id)).c,
    amIMember: !!(await q.isMember.get(c.id, req.userId)),
    createdBy: c.created_by ? await publicUser(c.created_by) : null,
    boosted: !!c.is_boosted,
    live: live[String(c.id)] || null,
  }));
  // Boosted rooms stay on top; within each group, rooms with people on cam
  // come first. Array.sort is stable, so the query's order is kept otherwise.
  rows.sort((a, b) => b.boosted - a.boosted || !!b.live - !!a.live);
  res.json({ rooms: rows });
});

app.post("/api/rooms/:id/boost", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || conv.type !== "room") return res.status(404).json({ error: "no such room" });
  if (conv.created_by !== req.userId) return res.status(403).json({ error: "only the host can boost this room" });
  const me = await q.profileById.get(req.userId);
  if (me.sparks < ROOM_BOOST_COST_SPARKS) {
    return res.status(400).json({ error: `Not enough sparks — boosting costs ${ROOM_BOOST_COST_SPARKS}.` });
  }
  // Atomic: two requests at once can't spend the same sparks twice.
  if ((await q.spendSparks.run(ROOM_BOOST_COST_SPARKS, req.userId, ROOM_BOOST_COST_SPARKS)).changes === 0) {
    return res.status(400).json({ error: "Not enough sparks." });
  }
  await q.extendRoomBoost.run(ROOM_BOOST_HOURS, id);
  res.json({ room: { ...await conversationView(await q.convById.get(id), req.userId), memberCount: (await q.memberCount.get(id)).c } });
});

app.post("/api/rooms", auth, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "give the room a name" });
  const topic = String(req.body?.topic || "").trim().slice(0, 140);
  const emoji = String(req.body?.emoji || "🌐").slice(0, 8) || "🌐";
  const color = String(req.body?.color || "#7d5fff");

  const conv = await q.insertRoom.run(title, topic, emoji, color, req.userId);
  const id = Number(conv.lastInsertRowid);
  await q.insertMember.run(id, req.userId);
  await safeStream(async () =>
    syncChannel({
      conversationId: id,
      type: "room",
      title,
      members: await q.membersOf.all(id),
      createdById: req.userId,
    })
  );
  await announce(id, `${(await publicUser(req.userId)).displayName} opened the room.`);
  res.json({ room: { ...await conversationView(await q.convById.get(id), req.userId), memberCount: 1, amIMember: true } });
});

app.post("/api/rooms/:id/join", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || conv.type !== "room") return res.status(404).json({ error: "no such room" });
  if (await q.isRoomBanned.get(id, req.userId)) {
    return res.status(403).json({ error: "The host has removed you from this room." });
  }

  if (!await q.isMember.get(id, req.userId)) {
    await q.insertMember.run(id, req.userId);
    const members = await q.membersOf.all(id);
    await safeStream(() =>
      addChannelMember(id, members.find((m) => m.user_id === req.userId))
    );
    await safeStream(() => getOrCreateRoomCall(id, members, conv.created_by ?? req.userId));
    await announce(id, `${(await publicUser(req.userId)).displayName} joined the room.`);
  }
  res.json({
    room: {
      ...await conversationView(await q.convById.get(id), req.userId),
      memberCount: (await q.memberCount.get(id)).c,
      amIMember: true,
    },
  });
});

// Host controls for a room's webcam call. Only the room's creator can use
// them, and never on themselves. "ban" also drops the person from the room
// and stops them rejoining it (room_bans) or its call (Stream call block).
const ROOM_MOD_ACTIONS = new Set(["mute", "camOff", "spotlight", "unspotlight", "remove", "ban"]);

app.post("/api/rooms/:id/moderate", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || conv.type !== "room") return res.status(404).json({ error: "no such room" });
  if (conv.created_by !== req.userId) return res.status(403).json({ error: "only the host can do that" });
  const action = String(req.body?.action || "");
  if (!ROOM_MOD_ACTIONS.has(action)) return res.status(400).json({ error: "unknown action" });
  const targetId = Number(req.body?.userId);
  if (!targetId || targetId === req.userId) return res.status(400).json({ error: "pick someone else" });
  const sessionId = String(req.body?.sessionId || "");
  if ((action === "spotlight" || action === "unspotlight") && !sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }
  if (!isStreamConfigured()) return res.status(503).json({ error: "Video isn't configured." });

  try {
    await moderateRoomCall(id, action, { targetId, sessionId, hostId: req.userId });
  } catch (err) {
    // Kicking someone who already left isn't worth failing a ban over.
    if (action !== "ban") return res.status(502).json({ error: err.message });
  }

  if (action === "ban") {
    const target = await publicUser(targetId);
    await q.addRoomBan.run(id, targetId, req.userId);
    if (await q.isMember.get(id, targetId)) {
      await q.removeMember.run(id, targetId);
      await safeStream(() => removeChannelMember(id, targetId));
      if (target) await announce(id, `${target.displayName} was removed by the host.`);
    }
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Go Live — broadcast to an audience, invite co-hosts, take gifts, share.
// Brings the "Social Streaming Rooms" idea (and DatingPro's live module) into
// cupidsCorner on the Stream stack the app already uses.
// ---------------------------------------------------------------------------

const MAX_LIVE_COHOSTS = 3;
export const LIVE_CATEGORIES = [
  "Dating", "Music", "Gaming", "Cooking", "Fitness", "Art", "Technology",
  "Comedy", "Dance", "Talk Show", "Education", "Social",
];
const liveQ = {
  active: db.prepare("SELECT * FROM live_streams WHERE status='live' ORDER BY id DESC LIMIT 50"),
  byId: db.prepare("SELECT * FROM live_streams WHERE id=?"),
  liveByHost: db.prepare("SELECT * FROM live_streams WHERE host_id=? AND status='live'"),
  insert: db.prepare("INSERT INTO live_streams (host_id, title, category) VALUES (?, ?, ?)"),
  end: db.prepare("UPDATE live_streams SET status='ended', ended_at=datetime('now') WHERE id=? AND status='live'"),
  addGiftSparks: db.prepare("UPDATE live_streams SET gift_sparks = gift_sparks + ? WHERE id=?"),
  cohosts: db.prepare("SELECT user_id FROM live_cohosts WHERE stream_id=? ORDER BY added_at"),
  addCohost: db.prepare("INSERT INTO live_cohosts (stream_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING"),
  removeCohost: db.prepare("DELETE FROM live_cohosts WHERE stream_id=? AND user_id=?"),
};

async function liveView(row, viewerId, counts = {}) {
  const cohostIds = (await liveQ.cohosts.all(row.id)).map((r) => r.user_id);
  const c = counts[String(row.id)];
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    giftSparks: row.gift_sparks,
    host: await publicUser(row.host_id),
    cohosts: (await mapAsync(cohostIds, (id) => publicUser(id))).filter(Boolean),
    viewers: c?.viewers ?? null,
    onAir: c ? c.isLive : null,
    isHost: row.host_id === viewerId,
    isCohost: cohostIds.includes(viewerId),
    callType: "livestream",
    callId: `live-${row.id}`,
    chatChannel: { type: "livestream", id: `live-${row.id}` },
  };
}

async function hostBlocksViewer(row, viewerId) {
  return !!await q.isBlocked.get(row.host_id, viewerId, viewerId, row.host_id);
}

app.get("/api/live", auth, async (req, res) => {
  const rows = await filterAsync(await liveQ.active.all(), async (r) => !(await hostBlocksViewer(r, req.userId)));
  let counts = {};
  if (isStreamConfigured()) {
    try {
      counts = await liveViewerCounts(rows.map((r) => r.id));
    } catch (err) {
      console.warn("[stream] live viewer counts failed:", err.message);
    }
  }
  const streams = await mapAsync(rows, (r) => liveView(r, req.userId, counts));
  streams.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
  res.json({ streams, categories: LIVE_CATEGORIES, videoConfigured: isStreamConfigured() });
});

app.post("/api/live", auth, async (req, res) => {
  if (!isStreamConfigured()) {
    return res.status(503).json({
      error: "Going live needs video. Add STREAM_API_KEY and STREAM_API_SECRET (free at https://dashboard.getstream.io).",
    });
  }
  const title = String(req.body?.title || "").trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: "give your stream a title" });

  // One broadcast per host: starting a new one ends the old one.
  for (const old of [await liveQ.liveByHost.get(req.userId)].filter(Boolean)) {
    await liveQ.end.run(old.id);
    await safeStream(() => endLiveCall(old.id));
  }

  const category = LIVE_CATEGORIES.includes(req.body?.category) ? req.body.category : "Social";
  const id = Number((await liveQ.insert.run(req.userId, title, category)).lastInsertRowid);
  try {
    await createLiveCall(id, await publicUser(req.userId), title);
    await ensureLiveChannel(id, title);
  } catch (err) {
    await liveQ.end.run(id);
    return res.status(502).json({ error: `Couldn't start the stream: ${err.message}` });
  }
  res.json({ stream: await liveView(await liveQ.byId.get(id), req.userId) });
});

app.get("/api/live/:id", auth, async (req, res) => {
  const row = await liveQ.byId.get(Number(req.params.id));
  if (!row || await hostBlocksViewer(row, req.userId)) return res.status(404).json({ error: "That stream isn't available." });
  res.json({ stream: await liveView(row, req.userId) });
});

app.post("/api/live/:id/cohosts", auth, async (req, res) => {
  const row = await liveQ.byId.get(Number(req.params.id));
  if (!row || row.status !== "live") return res.status(404).json({ error: "That stream has ended." });
  if (row.host_id !== req.userId) return res.status(403).json({ error: "only the host can invite co-hosts" });
  const targetId = Number(req.body?.userId);
  const target = targetId && targetId !== req.userId ? await publicUser(targetId) : null;
  if (!target || await hostBlocksViewer(row, targetId)) return res.status(400).json({ error: "pick someone else" });
  if ((await liveQ.cohosts.all(row.id)).length >= MAX_LIVE_COHOSTS) {
    return res.status(400).json({ error: `Up to ${MAX_LIVE_COHOSTS} co-hosts per stream.` });
  }
  try {
    await setLiveCohost(row.id, target, true);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  await liveQ.addCohost.run(row.id, targetId);
  await safeStream(() => sendLiveSystemMessage(row.id, `${target.displayName} is now co-hosting.`));
  res.json({ stream: await liveView(await liveQ.byId.get(row.id), req.userId) });
});

// The host removes a co-host, or a co-host steps down themselves.
app.delete("/api/live/:id/cohosts/:userId", auth, async (req, res) => {
  const row = await liveQ.byId.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "no such stream" });
  const targetId = Number(req.params.userId);
  if (row.host_id !== req.userId && targetId !== req.userId) {
    return res.status(403).json({ error: "only the host can do that" });
  }
  await liveQ.removeCohost.run(row.id, targetId);
  const target = await publicUser(targetId);
  if (target && row.status === "live") {
    await safeStream(() => setLiveCohost(row.id, target, false));
  }
  res.json({ stream: await liveView(await liveQ.byId.get(row.id), req.userId) });
});

app.post("/api/live/:id/end", auth, async (req, res) => {
  const row = await liveQ.byId.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "no such stream" });
  if (row.host_id !== req.userId) return res.status(403).json({ error: "only the host can end the stream" });
  await liveQ.end.run(row.id);
  await safeStream(() => sendLiveSystemMessage(row.id, "The stream has ended. Thanks for watching!"));
  await safeStream(() => endLiveCall(row.id));
  await safeStream(() => freezeLiveChannel(row.id));
  res.json({ stream: await liveView(await liveQ.byId.get(row.id), req.userId) });
});

// Gifts on a live stream go to the host or one of the co-hosts. Same sparks
// rules as gifts in chat: the sender spends, nothing is minted.
app.post("/api/live/:id/gift", auth, async (req, res) => {
  const row = await liveQ.byId.get(Number(req.params.id));
  if (!row || row.status !== "live") return res.status(404).json({ error: "That stream has ended." });
  const gift = GIFT_BY_KEY[String(req.body?.giftKey || "")];
  if (!gift) return res.status(400).json({ error: "unknown gift" });
  const recipientId = Number(req.body?.recipientId) || row.host_id;
  const onStage = [row.host_id, ...(await liveQ.cohosts.all(row.id)).map((r) => r.user_id)];
  if (!onStage.includes(recipientId)) return res.status(400).json({ error: "gifts go to the host or a co-host" });
  if (recipientId === req.userId) return res.status(400).json({ error: "you can't gift yourself" });
  if (await q.isBlocked.get(req.userId, recipientId, recipientId, req.userId)) {
    return res.status(403).json({ error: "unavailable" });
  }
  const me = await q.profileById.get(req.userId);
  if (me.sparks < gift.cost) {
    return res.status(400).json({ error: `Not enough sparks — ${gift.name} costs ${gift.cost}.` });
  }
  // Atomic: two requests at once can't spend the same sparks twice.
  if ((await q.spendSparks.run(gift.cost, req.userId, gift.cost)).changes === 0) {
    return res.status(400).json({ error: "Not enough sparks." });
  }
  await q.insertGift.run(req.userId, recipientId, gift.key, null);
  await liveQ.addGiftSparks.run(gift.cost, row.id);
  const from = (await publicUser(req.userId)).displayName;
  const to = (await publicUser(recipientId)).displayName;
  await safeStream(() =>
    sendLiveSystemMessage(row.id, `${from} sent ${gift.emoji} ${gift.name} to ${to}`, { messageKind: "gift", gift })
  );
  res.json({ ok: true, sparks: (await q.profileById.get(req.userId)).sparks, gift });
});

// ---------------------------------------------------------------------------
// Stream — API key + tokens for the client SDKs, and webcam room calls
// ---------------------------------------------------------------------------

app.get("/api/stream/credentials", auth, async (req, res) => {
  if (!isStreamConfigured()) {
    return res.status(503).json({
      error:
        "Stream isn't configured yet. Add STREAM_API_KEY and STREAM_API_SECRET to a .env file (free at https://dashboard.getstream.io).",
    });
  }
  const creds = await streamCredentialsFor(await publicUser(req.userId));
  res.json(creds);
});

app.post("/api/conversations/:id/call", auth, async (req, res) => {
  if (!isStreamConfigured()) {
    return res.status(503).json({
      error:
        "Video calling isn't configured yet. Add STREAM_API_KEY and STREAM_API_SECRET to a .env file (free at https://dashboard.getstream.io).",
    });
  }
  const id = Number(req.params.id);
  const conv = await q.convById.get(id);
  if (!conv || !await q.isMember.get(id, req.userId)) {
    return res.status(403).json({ error: "not a member" });
  }
  if (await isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  if (conv.type === "ai") {
    return res.status(400).json({ error: "Cupid doesn't do video calls (yet)" });
  }
  const members = await q.membersOf.all(id);
  const call = await getOrCreateRoomCall(id, members, req.userId);
  res.json(call);
});

// ---------------------------------------------------------------------------
// billing — buy sparks with real money via Stripe Checkout (optional)
// ---------------------------------------------------------------------------

app.get("/api/billing/packs", auth, (req, res) => {
  res.json({ configured: isBillingConfigured(), packs: SPARK_PACKS });
});

app.post("/api/billing/checkout", auth, async (req, res) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({
      error: "Payments aren't configured yet. Add STRIPE_SECRET_KEY to a .env file.",
    });
  }
  const packKey = String(req.body?.packKey || "");
  if (!PACK_BY_KEY[packKey]) return res.status(400).json({ error: "unknown pack" });
  const origin = req.get("origin") || `${req.protocol}://${req.get("host")}`;
  try {
    const url = await createCheckoutSession({
      userId: req.userId,
      packKey,
      successUrl: `${origin}/sparks?status=success`,
      cancelUrl: `${origin}/sparks?status=cancelled`,
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buying sparks inside the Android app with Google Play (see playBilling.js)
registerPlayBillingRoutes(app, { auth, q, rateLimit });

// ---------------------------------------------------------------------------
// paid voice sessions with Cupid, the AI coach (see coach.js)
// ---------------------------------------------------------------------------

registerCoachRoutes(app, { auth, q, rateLimit });

// ---------------------------------------------------------------------------
// member feed and public blog (see social.js)
// ---------------------------------------------------------------------------

registerSocialRoutes(app, { auth, adminOnly, isAdmin, q, rateLimit, upload, uploadsDir });

// ---------------------------------------------------------------------------
// profile fields, photo albums and their review queue, winks, invites (see
// extras.js) and the open meetup board (see meetups.js)
// ---------------------------------------------------------------------------

// The chat between two members, created if they don't have one yet.
async function openDm(aId, bId, systemText) {
  const existing = await q.dmBetween.get(aId, bId);
  if (existing) return existing.id;
  const conversationId = Number((await q.insertConversation.run("dm", "", aId)).lastInsertRowid);
  await q.insertMember.run(conversationId, aId);
  await q.insertMember.run(conversationId, bId);
  await q.insertMessage.run(conversationId, null, "system", systemText, null);
  await safeStream(async () =>
    syncChannel({ conversationId, type: "dm", title: "", members: await q.membersOf.all(conversationId), createdById: aId })
  );
  await safeStream(() => sendSystemMessage(conversationId, systemText));
  return conversationId;
}

registerExtrasRoutes(app, { auth, adminOnly, q, rateLimit, upload, uploadsDir, publicUser });
registerMeetupRoutes(app, { auth, q, rateLimit, publicUser, openDm });
registerCampaignRoutes(app, { auth, adminOnly });

// The compatibility questionnaire (see questionnaire.js).
registerQuestionnaireRoutes(app, { auth, adminOnly, q, rateLimit });

// ---------------------------------------------------------------------------
// paid API (x402): pay-per-call compatibility scoring
// ---------------------------------------------------------------------------

if (isX402Configured()) {
  app.use(x402Gate());
  app.post(COMPAT_ROUTE, async (req, res) => {
    const parsed = parseProfiles(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.json(await compatibility(parsed.profileA, parsed.profileB));
  });
} else {
  // Never serve this route unpaid.
  app.post(COMPAT_ROUTE, (req, res) =>
    res.status(503).json({ error: "Paid endpoint not configured (set X402_PAY_TO)." }),
  );
}

// ---------------------------------------------------------------------------
// static client (production)
// ---------------------------------------------------------------------------

const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Catches multer upload errors (bad size/type) so they come back as clean
// JSON instead of an HTML stack trace.
app.use((err, req, res, next) => {
  if (err?.name === "MulterError") {
    return res.status(400).json({ error: "Image too large (max 5MB) or invalid file." });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

// Conversations created while Stream wasn't configured (e.g. seed data)
// have no Stream channel, or an empty one, so members can't read them.
// Reconcile every non-AI conversation once at startup; idempotent.
async function backfillStreamChannels() {
  const convs = await db.prepare("SELECT * FROM conversations WHERE type != 'ai'").all();
  for (const conv of convs) {
    const members = await q.membersOf.all(conv.id);
    if (!members.length) continue;
    await safeStream(() =>
      syncChannel({
        conversationId: conv.id,
        type: conv.type,
        title: conv.title,
        members,
        createdById: conv.created_by ?? members[0].user_id,
      })
    );
  }
  console.log(`[stream] synced ${convs.length} conversation channel(s)`);
}

await q.deleteExpiredSessions.run(SESSION_DAYS);
setInterval(() => q.deleteExpiredSessions.run(SESSION_DAYS).catch((err) => console.error(err)), 6 * 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Cupid's Corner API on http://localhost:${PORT}`);
  if (isStreamConfigured()) backfillStreamChannels().catch((err) => console.error(err));
});
