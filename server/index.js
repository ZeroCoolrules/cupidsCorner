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
} from "./stream.js";
import {
  syncChannel,
  addChannelMember,
  removeChannelMember,
  sendSystemMessage,
  sendGiftMessage,
  setChannelFrozen,
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

export const REACTION_EMOJIS = ["❤️", "😂", "👍", "😮", "😢"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
// Both configurable so a Render persistent disk (or any external volume)
// can be pointed at without code changes — see README "Deploy to Render".
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

initDb();

const app = express();
// Render terminates TLS in front of us; trust it so req.protocol is "https"
// (x402 builds the 402 `resource.url` from it).
app.set("trust proxy", 1);
app.use(cors());

// Stripe needs the raw, unparsed request body to verify its signature, so
// this route is registered before the global express.json() below.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), (req, res) => {
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
    if (userId && pack) q.addSparks.run(pack.sparks, userId);
  }
  res.json({ received: true });
});

app.use(express.json());
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
function typingNamesFor(conversationId, excludeUserId) {
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
    const p = q.profileById.get(uid);
    if (p) names.push(p.display_name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const q = {
  userByName: db.prepare("SELECT * FROM users WHERE username = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
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
    SELECT s.token, s.user_id, u.username FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `),
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
      last_read_id = MAX(last_read_id, excluded.last_read_id), updated_at = datetime('now')
  `),
  readStateAll: db.prepare("SELECT user_id, last_read_id FROM read_state WHERE conversation_id = ?"),
};

function publicUser(userId) {
  const p = q.profileById.get(userId);
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
    isPremium: !!q.isPremium.get(userId)?.active,
  };
}

function auth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const sess = token && q.sessionByToken.get(token);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  req.userId = sess.user_id;
  req.username = sess.username;
  q.touchLastSeen.run(req.userId);
  next();
}

function ensureAiConversation(userId) {
  let row = q.aiConvFor.get(userId);
  if (row) return row.id;
  const conv = q.insertConversation.run("ai", "Cupid", null);
  const id = Number(conv.lastInsertRowid);
  q.insertMember.run(id, userId);
  q.insertMessage.run(id, null, "ai", CUPID_WELCOME, null);
  return id;
}

// Records a system-style line in both the local fallback log and (if
// configured) the live Stream channel, so it shows up no matter which
// transport the client ends up using.
async function announce(conversationId, text) {
  q.insertMessage.run(conversationId, null, "system", text, null);
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

app.get("/api/public/stats", (req, res) => {
  const members = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const rooms = db.prepare("SELECT COUNT(*) c FROM conversations WHERE type='room'").get().c;
  const matches = db.prepare("SELECT COUNT(*) c FROM matches").get().c;
  const gifts = db.prepare("SELECT COUNT(*) c FROM gifts_sent").get().c;
  res.json({ members, rooms, matches, gifts });
});

// ---------------------------------------------------------------------------
// auth routes
// ---------------------------------------------------------------------------

app.post("/api/auth/signup", (req, res) => {
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
    avatarColor = "#ff6b8a",
    interests = [],
  } = req.body || {};

  if (!username || !password || !displayName) {
    return res
      .status(400)
      .json({ error: "username, password and displayName are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }
  if (q.userByName.get(username)) {
    return res.status(409).json({ error: "That username is taken" });
  }

  const hash = bcrypt.hashSync(String(password), 10);
  const info = q.insertUser.run(String(username).trim(), hash);
  const userId = Number(info.lastInsertRowid);
  q.insertProfile.run({
    user_id: userId,
    display_name: String(displayName).trim(),
    age: age ? Number(age) : null,
    gender: String(gender),
    orientation: String(orientation),
    bio: String(bio),
    city: String(city),
    avatar_emoji: String(avatarEmoji).slice(0, 8) || "💘",
    avatar_color: String(avatarColor),
    interests: JSON.stringify(Array.isArray(interests) ? interests : []),
  });
  ensureAiConversation(userId);

  const token = crypto.randomBytes(24).toString("hex");
  q.insertSession.run(token, userId);
  res.json({ token, user: publicUser(userId) });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = username && q.userByName.get(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  q.insertSession.run(token, user.id);
  ensureAiConversation(user.id);
  res.json({ token, user: publicUser(user.id) });
});

app.post("/api/auth/logout", auth, (req, res) => {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  q.deleteSession.run(token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

app.get("/api/me", auth, (req, res) => {
  res.json({ user: publicUser(req.userId) });
});

app.put("/api/me", auth, (req, res) => {
  const cur = q.profileById.get(req.userId);
  const b = req.body || {};
  q.updateProfile.run({
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
    q.updatePrompts.run(JSON.stringify(cleaned), req.userId);
  }
  res.json({ user: publicUser(req.userId) });
});

app.post("/api/me/photo", auth, upload.single("photo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Upload a jpg, png, webp, or gif under 5MB." });
  }
  const cur = q.profileById.get(req.userId);
  if (cur.photo_url) {
    fs.unlink(path.join(uploadsDir, path.basename(cur.photo_url)), () => {});
  }
  q.setPhoto.run(`/uploads/${req.file.filename}`, req.userId);
  res.json({ user: publicUser(req.userId) });
});

app.delete("/api/me/photo", auth, (req, res) => {
  const cur = q.profileById.get(req.userId);
  if (cur.photo_url) {
    fs.unlink(path.join(uploadsDir, path.basename(cur.photo_url)), () => {});
  }
  q.setPhoto.run(null, req.userId);
  res.json({ user: publicUser(req.userId) });
});

app.get("/api/prompts/bank", (req, res) => {
  res.json({ bank: PROMPT_BANK });
});

// Public profile: another user's card plus their rating / fan / gift stats.
app.get("/api/users/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const user = publicUser(id);
  if (!user) return res.status(404).json({ error: "no such user" });
  const rating = q.ratingSummary.get(id);
  const mine = q.myRating.get(req.userId, id);
  res.json({
    user: id === req.userId ? user : { ...user, sparks: undefined },
    isSelf: id === req.userId,
    rating: { average: rating.avg, count: rating.n },
    myRating: mine ? mine.stars : null,
    fans: { count: q.fanCount.get(id).c, amIFan: !!q.amIFan.get(req.userId, id) },
    gifts: { receivedCount: q.giftsReceivedCount.get(id).c },
    amIBlocking: !!q.amIBlocking.get(req.userId, id),
  });
});

// Blocking shuts the DM for both people: our routes refuse it (isBlockedDm)
// and the Stream channel is frozen so nobody can post into it directly.
app.post("/api/users/:id/block", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "can't block yourself" });
  if (!q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  q.addBlock.run(req.userId, id);
  const dm = q.dmBetween.get(req.userId, id);
  if (dm) await safeStream(() => setChannelFrozen(dm.id, true));
  res.json({ ok: true, blocked: true });
});

app.delete("/api/users/:id/block", auth, async (req, res) => {
  const id = Number(req.params.id);
  q.removeBlock.run(req.userId, id);
  // Stay frozen if the other person is still blocking this user.
  const dm = q.dmBetween.get(req.userId, id);
  if (dm && !q.isBlocked.get(req.userId, id, id, req.userId)) {
    await safeStream(() => setChannelFrozen(dm.id, false));
  }
  res.json({ ok: true, blocked: false });
});

app.post("/api/users/:id/report", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  const reason = String(req.body?.reason || "").trim().slice(0, 500) || "No reason given";
  q.insertReport.run(req.userId, id, reason);
  res.json({ ok: true });
});

// Free users get a count + upgrade prompt; premium unlocks the full list.
app.get("/api/likes", auth, (req, res) => {
  const rows = q.likedMeNotBack
    .all(req.userId, req.userId)
    .filter((r) => !q.isBlocked.get(req.userId, r.swiper_id, r.swiper_id, req.userId));
  const premium = !!q.isPremium.get(req.userId)?.active;
  res.json({
    count: rows.length,
    locked: !premium,
    profiles: premium ? rows.map((r) => publicUser(r.swiper_id)) : [],
  });
});

app.post("/api/me/premium", auth, (req, res) => {
  const me = q.profileById.get(req.userId);
  if (me.sparks < PREMIUM_COST_SPARKS) {
    return res.status(400).json({ error: `Not enough sparks — Premium costs ${PREMIUM_COST_SPARKS}.` });
  }
  q.addSparks.run(-PREMIUM_COST_SPARKS, req.userId);
  q.extendPremium.run(PREMIUM_DAYS, req.userId);
  res.json({ user: publicUser(req.userId) });
});

app.post("/api/me/daily-bonus", auth, (req, res) => {
  const row = q.bonusEligible.get(DAILY_BONUS_COOLDOWN_HOURS, req.userId);
  if (!row.eligible) {
    return res.json({ claimed: false, sparks: q.profileById.get(req.userId).sparks });
  }
  q.claimBonus.run(DAILY_BONUS_SPARKS, req.userId);
  res.json({
    claimed: true,
    amount: DAILY_BONUS_SPARKS,
    sparks: q.profileById.get(req.userId).sparks,
  });
});

app.get("/api/users/:id/gifts", auth, (req, res) => {
  const id = Number(req.params.id);
  const rows = q.giftsReceived.all(id).map((g) => ({
    id: g.id,
    gift: GIFT_BY_KEY[g.gift_key] || { key: g.gift_key, emoji: "🎁", name: g.gift_key },
    sender: { name: g.sender_name, emoji: g.sender_emoji, color: g.sender_color },
    createdAt: g.created_at,
  }));
  res.json({ gifts: rows, total: q.giftsReceivedCount.get(id).c });
});

app.post("/api/users/:id/rating", auth, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "can't rate yourself" });
  if (!q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  if (q.isBlocked.get(req.userId, id, id, req.userId)) return res.status(403).json({ error: "unavailable" });
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: "stars must be 1-5" });
  }
  q.upsertRating.run(req.userId, id, stars);
  const rating = q.ratingSummary.get(id);
  res.json({ rating: { average: rating.avg, count: rating.n }, myRating: stars });
});

app.post("/api/users/:id/fan", auth, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "can't fan yourself" });
  if (!q.userById.get(id)) return res.status(404).json({ error: "no such user" });
  if (q.isBlocked.get(req.userId, id, id, req.userId)) return res.status(403).json({ error: "unavailable" });
  q.addFan.run(req.userId, id);
  res.json({ fans: { count: q.fanCount.get(id).c, amIFan: true } });
});

app.delete("/api/users/:id/fan", auth, (req, res) => {
  const id = Number(req.params.id);
  q.removeFan.run(req.userId, id);
  res.json({ fans: { count: q.fanCount.get(id).c, amIFan: false } });
});

// ---------------------------------------------------------------------------
// gifts
// ---------------------------------------------------------------------------

app.get("/api/gifts/catalog", auth, (req, res) => {
  res.json({ catalog: GIFT_CATALOG, sparks: q.profileById.get(req.userId).sparks });
});

app.post("/api/gifts/send", auth, async (req, res) => {
  const recipientId = Number(req.body?.recipientId);
  const giftKey = String(req.body?.giftKey || "");
  const conversationId = req.body?.conversationId ? Number(req.body.conversationId) : null;
  const gift = GIFT_BY_KEY[giftKey];

  if (!gift) return res.status(400).json({ error: "unknown gift" });
  if (!recipientId || recipientId === req.userId || !q.userById.get(recipientId)) {
    return res.status(400).json({ error: "bad recipient" });
  }
  if (q.isBlocked.get(req.userId, recipientId, recipientId, req.userId)) {
    return res.status(403).json({ error: "unavailable" });
  }
  const me = q.profileById.get(req.userId);
  if (me.sparks < gift.cost) {
    return res.status(400).json({ error: `Not enough sparks — ${gift.name} costs ${gift.cost}.` });
  }
  if (conversationId && !q.isMember.get(conversationId, req.userId)) {
    return res.status(403).json({ error: "not a member of that conversation" });
  }

  q.addSparks.run(-gift.cost, req.userId);
  q.insertGift.run(req.userId, recipientId, giftKey, conversationId);

  if (conversationId) {
    const text = `${publicUser(req.userId).displayName} sent ${gift.emoji} ${gift.name}`;
    q.insertMessage.run(conversationId, req.userId, "gift", text, giftKey);
    await safeStream(() => sendGiftMessage(conversationId, req.userId, gift));
  }

  res.json({ ok: true, sparks: q.profileById.get(req.userId).sparks, gift });
});

// ---------------------------------------------------------------------------
// discovery + swiping
// ---------------------------------------------------------------------------

app.get("/api/discover", auth, (req, res) => {
  const clauses = [
    "p.user_id != ?",
    "p.user_id NOT IN (SELECT target_id FROM swipes WHERE swiper_id = ?)",
    "p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)",
    "p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)",
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
    clauses.push("p.interests LIKE ?");
    params.push(`%${interest}%`);
  }
  if (req.query.sameCity === "1") {
    const me = q.profileById.get(req.userId);
    if (me.city) {
      clauses.push("p.city = ?");
      params.push(me.city);
    }
  }

  const rows = db
    .prepare(
      `SELECT p.user_id FROM profiles p
       WHERE ${clauses.join(" AND ")}
       ORDER BY (p.premium_until IS NOT NULL AND p.premium_until > datetime('now')) DESC, RANDOM()
       LIMIT 25`
    )
    .all(...params);
  res.json({ profiles: rows.map((r) => publicUser(r.user_id)) });
});

app.post("/api/swipe", auth, async (req, res) => {
  const targetId = Number(req.body?.targetId);
  const direction = req.body?.direction === "like" ? "like" : "pass";
  if (!targetId || targetId === req.userId || !q.userById.get(targetId)) {
    return res.status(400).json({ error: "bad target" });
  }
  if (q.isBlocked.get(req.userId, targetId, targetId, req.userId)) {
    return res.status(403).json({ error: "unavailable" });
  }
  q.insertSwipe.run(req.userId, targetId, direction);

  let matched = false;
  let conversationId = null;
  if (direction === "like") {
    const back = q.swipeBetween.get(targetId, req.userId);
    if (back && back.direction === "like") {
      const [a, b] = pair(req.userId, targetId);
      q.insertMatch.run(a, b);
      matched = true;
      // create the DM conversation for the match if missing
      const existing = q.dmBetween.get(req.userId, targetId);
      if (existing) {
        conversationId = existing.id;
      } else {
        const conv = q.insertConversation.run("dm", "", req.userId);
        conversationId = Number(conv.lastInsertRowid);
        q.insertMember.run(conversationId, req.userId);
        q.insertMember.run(conversationId, targetId);
        q.insertMessage.run(conversationId, null, "system", "You matched! Say hello 👋", null);
        await safeStream(() =>
          syncChannel({
            conversationId,
            type: "dm",
            title: "",
            members: q.membersOf.all(conversationId),
            createdById: req.userId,
          })
        );
        await safeStream(() => sendSystemMessage(conversationId, "You matched! Say hello 👋"));
      }
    }
  }
  res.json({ matched, conversationId, target: publicUser(targetId) });
});

app.get("/api/matches", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS other, created_at
       FROM matches WHERE user_a = ? OR user_b = ? ORDER BY id DESC`
    )
    .all(req.userId, req.userId, req.userId);
  const matches = rows.map((r) => {
    const dm = q.dmBetween.get(req.userId, r.other);
    return {
      user: publicUser(r.other),
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
function isBlockedDm(conversationId, meId) {
  const conv = q.convById.get(conversationId);
  if (conv?.type !== "dm") return false;
  const other = q.membersOf.all(conversationId).find((m) => m.user_id !== meId);
  return !!other && !!q.isBlocked.get(meId, other.user_id, other.user_id, meId);
}

function conversationView(conv, meId) {
  const members = q.membersOf.all(conv.id);
  const last = q.lastMessage.get(conv.id);
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
    color = "#ff4d6d";
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

app.get("/api/conversations", auth, (req, res) => {
  const rows = q.myConversations.all(req.userId);
  const list = rows
    .map((c) => conversationView(c, req.userId))
    .filter((c) => {
      if (c.type !== "dm") return true;
      const other = c.members.find((m) => m.id !== req.userId);
      return !other || !q.isBlocked.get(req.userId, other.id, other.id, req.userId);
    })
    .sort((a, b) => {
      // AI pinned first, then by recency of last message id-ish (keep DB order otherwise)
      if (a.type === "ai") return -1;
      if (b.type === "ai") return 1;
      return 0;
    });
  res.json({ conversations: list });
});

app.get("/api/conversations/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const conv = q.convById.get(id);
  if (!conv || !q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  res.json({ conversation: conversationView(conv, req.userId) });
});

app.post("/api/conversations/group", auth, async (req, res) => {
  const title = String(req.body?.title || "").trim() || "Group chat";
  const memberIds = Array.isArray(req.body?.memberIds)
    ? [...new Set(req.body.memberIds.map(Number).filter(Boolean))]
    : [];
  const conv = q.insertConversation.run("group", title, req.userId);
  const id = Number(conv.lastInsertRowid);
  q.insertMember.run(id, req.userId);
  for (const m of memberIds) {
    if (m !== req.userId && q.userById.get(m)) q.insertMember.run(id, m);
  }
  await safeStream(() =>
    syncChannel({
      conversationId: id,
      type: "group",
      title,
      members: q.membersOf.all(id),
      createdById: req.userId,
    })
  );
  await announce(id, `${publicUser(req.userId).displayName} started the group.`);
  res.json({ conversation: conversationView(q.convById.get(id), req.userId) });
});

app.post("/api/conversations/:id/members", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = q.convById.get(id);
  if (!conv || conv.type !== "group") return res.status(404).json({ error: "no group" });
  if (!q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  const userId = Number(req.body?.userId);
  if (!userId || !q.userById.get(userId)) return res.status(400).json({ error: "bad user" });
  q.insertMember.run(id, userId);
  const p = q.profileById.get(userId);
  await safeStream(() => addChannelMember(id, q.membersOf.all(id).find((m) => m.user_id === userId)));
  await announce(id, `${p.display_name} was added.`);
  res.json({ conversation: conversationView(q.convById.get(id), req.userId) });
});

app.post("/api/conversations/:id/leave", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = q.convById.get(id);
  if (!conv || (conv.type !== "group" && conv.type !== "room")) {
    return res.status(400).json({ error: "can't leave this conversation" });
  }
  if (!q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  const me = publicUser(req.userId);
  q.removeMember.run(id, req.userId);
  await safeStream(() => removeChannelMember(id, req.userId));
  if (q.memberCount.get(id).c > 0) {
    await announce(id, `${me.displayName} left.`);
  }
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  const after = Number(req.query.after || 0);

  const reactionRows = q.reactionsByConv.all(id);
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

  const messages = q.messagesAfter.all(id, after).map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    senderName: m.kind === "ai" ? "Cupid" : m.sender_name,
    senderEmoji: m.kind === "ai" ? "💘" : m.sender_emoji,
    senderColor: m.kind === "ai" ? "#ff4d6d" : m.sender_color,
    kind: m.kind,
    body: m.body,
    gift: m.gift_key ? GIFT_BY_KEY[m.gift_key] || null : null,
    createdAt: m.created_at,
    mine: m.sender_id === req.userId,
    reactions: reactionsByMessage.get(m.id) || [],
  }));

  const latest = q.lastMessage.get(id);
  if (latest) q.upsertReadState.run(id, req.userId, latest.id);

  res.json({
    messages,
    conversation: conversationView(q.convById.get(id), req.userId),
    typing: typingNamesFor(id, req.userId),
    reads: q.readStateAll.all(id),
  });
});

app.post("/api/conversations/:id/typing", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  markTyping(id, req.userId);
  res.json({ ok: true });
});

app.post("/api/conversations/:id/messages/:messageId/react", auth, (req, res) => {
  const id = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!q.isMember.get(id, req.userId)) return res.status(403).json({ error: "not a member" });
  if (isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  const emoji = String(req.body?.emoji || "");
  if (!REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: "unknown reaction" });

  if (q.hasReaction.get(id, messageId, req.userId, emoji)) {
    q.removeReaction.run(id, messageId, req.userId, emoji);
  } else {
    q.addReaction.run(id, messageId, req.userId, emoji);
  }
  const mine = new Set(
    db
      .prepare("SELECT emoji FROM message_reactions WHERE conversation_id=? AND message_id=? AND user_id=?")
      .all(id, messageId, req.userId)
      .map((r) => r.emoji)
  );
  const all = db
    .prepare(
      "SELECT emoji, COUNT(*) AS c FROM message_reactions WHERE conversation_id=? AND message_id=? GROUP BY emoji"
    )
    .all(id, messageId);
  res.json({ reactions: all.map((r) => ({ emoji: r.emoji, count: r.c, mine: mine.has(r.emoji) })) });
});

app.post("/api/conversations/:id/messages", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = q.convById.get(id);
  if (!conv || !q.isMember.get(id, req.userId))
    return res.status(403).json({ error: "not a member" });
  if (isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "empty message" });
  if (body.length > 4000) return res.status(400).json({ error: "message too long" });

  const info = q.insertMessage.run(id, req.userId, "text", body, null);
  const created = { id: Number(info.lastInsertRowid) };

  if (conv.type === "ai") {
    const history = db
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
    q.insertMessage.run(id, null, "ai", reply, null);
  }

  res.json({ ok: true, id: created.id });
});

// ---------------------------------------------------------------------------
// public rooms — Cyber Friends–style, browsable, no match required to join
// ---------------------------------------------------------------------------

app.get("/api/rooms", auth, async (req, res) => {
  const convs = q.publicRoomsRanked.all();
  let live = {};
  if (isStreamConfigured()) {
    try {
      live = await liveRoomStatus(convs.map((c) => c.id));
    } catch (err) {
      console.warn("[stream] live room status failed:", err.message);
    }
  }
  const rows = convs.map((c) => ({
    ...conversationView(c, req.userId),
    memberCount: q.memberCount.get(c.id).c,
    amIMember: !!q.isMember.get(c.id, req.userId),
    createdBy: c.created_by ? publicUser(c.created_by) : null,
    boosted: !!c.is_boosted,
    live: live[String(c.id)] || null,
  }));
  // Boosted rooms stay on top; within each group, rooms with people on cam
  // come first. Array.sort is stable, so the query's order is kept otherwise.
  rows.sort((a, b) => b.boosted - a.boosted || !!b.live - !!a.live);
  res.json({ rooms: rows });
});

app.post("/api/rooms/:id/boost", auth, (req, res) => {
  const id = Number(req.params.id);
  const conv = q.convById.get(id);
  if (!conv || conv.type !== "room") return res.status(404).json({ error: "no such room" });
  if (conv.created_by !== req.userId) return res.status(403).json({ error: "only the host can boost this room" });
  const me = q.profileById.get(req.userId);
  if (me.sparks < ROOM_BOOST_COST_SPARKS) {
    return res.status(400).json({ error: `Not enough sparks — boosting costs ${ROOM_BOOST_COST_SPARKS}.` });
  }
  q.addSparks.run(-ROOM_BOOST_COST_SPARKS, req.userId);
  q.extendRoomBoost.run(ROOM_BOOST_HOURS, id);
  res.json({ room: { ...conversationView(q.convById.get(id), req.userId), memberCount: q.memberCount.get(id).c } });
});

app.post("/api/rooms", auth, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "give the room a name" });
  const topic = String(req.body?.topic || "").trim().slice(0, 140);
  const emoji = String(req.body?.emoji || "🌐").slice(0, 8) || "🌐";
  const color = String(req.body?.color || "#7d5fff");

  const conv = q.insertRoom.run(title, topic, emoji, color, req.userId);
  const id = Number(conv.lastInsertRowid);
  q.insertMember.run(id, req.userId);
  await safeStream(() =>
    syncChannel({
      conversationId: id,
      type: "room",
      title,
      members: q.membersOf.all(id),
      createdById: req.userId,
    })
  );
  await announce(id, `${publicUser(req.userId).displayName} opened the room.`);
  res.json({ room: { ...conversationView(q.convById.get(id), req.userId), memberCount: 1, amIMember: true } });
});

app.post("/api/rooms/:id/join", auth, async (req, res) => {
  const id = Number(req.params.id);
  const conv = q.convById.get(id);
  if (!conv || conv.type !== "room") return res.status(404).json({ error: "no such room" });
  if (q.isRoomBanned.get(id, req.userId)) {
    return res.status(403).json({ error: "The host has removed you from this room." });
  }

  if (!q.isMember.get(id, req.userId)) {
    q.insertMember.run(id, req.userId);
    const members = q.membersOf.all(id);
    await safeStream(() =>
      addChannelMember(id, members.find((m) => m.user_id === req.userId))
    );
    await safeStream(() => getOrCreateRoomCall(id, members, conv.created_by ?? req.userId));
    await announce(id, `${publicUser(req.userId).displayName} joined the room.`);
  }
  res.json({
    room: {
      ...conversationView(q.convById.get(id), req.userId),
      memberCount: q.memberCount.get(id).c,
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
  const conv = q.convById.get(id);
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
    const target = publicUser(targetId);
    q.addRoomBan.run(id, targetId, req.userId);
    if (q.isMember.get(id, targetId)) {
      q.removeMember.run(id, targetId);
      await safeStream(() => removeChannelMember(id, targetId));
      if (target) await announce(id, `${target.displayName} was removed by the host.`);
    }
  }
  res.json({ ok: true });
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
  const creds = await streamCredentialsFor(publicUser(req.userId));
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
  const conv = q.convById.get(id);
  if (!conv || !q.isMember.get(id, req.userId)) {
    return res.status(403).json({ error: "not a member" });
  }
  if (isBlockedDm(id, req.userId)) return res.status(403).json({ error: "This chat is unavailable." });
  if (conv.type === "ai") {
    return res.status(400).json({ error: "Cupid doesn't do video calls (yet)" });
  }
  const members = q.membersOf.all(id);
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
  const convs = db.prepare("SELECT * FROM conversations WHERE type != 'ai'").all();
  for (const conv of convs) {
    const members = q.membersOf.all(conv.id);
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

app.listen(PORT, () => {
  console.log(`Cupid's Corner API on http://localhost:${PORT}`);
  if (isStreamConfigured()) backfillStreamChannels();
});
