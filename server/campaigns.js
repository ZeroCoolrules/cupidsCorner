// Launch campaigns: opening the site one place at a time.
//
// A dating site only works where there are enough people nearby, so growth
// is run place by place. Each campaign is a place (a state to start with)
// with its own public page and sign-up link. Someone who joins through a
// campaign is counted under it, and the first members in each place are
// "founding members" who get free Premium and some sparks as a thank-you
// for joining early.
//
// Campaigns live in the database, seeded with the first four states. Admins
// can add more, or pause one, without a deploy.
//
// Settings (environment variables, all optional):
//   FOUNDING_MEMBER_LIMIT   founding spots per campaign (default 500)
//   FOUNDING_PREMIUM_DAYS   days of Premium for a founding member (default 90)
//   FOUNDING_SPARKS         sparks for a founding member (default 500)

import { db } from "./db.js";

const intEnv = (name, fallback, min, max) => {
  const raw = process.env[name];
  const n = Math.round(Number(raw));
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export const FOUNDING_MEMBER_LIMIT = intEnv("FOUNDING_MEMBER_LIMIT", 500, 0, 1_000_000);
export const FOUNDING_PREMIUM_DAYS = intEnv("FOUNDING_PREMIUM_DAYS", 90, 0, 365);
export const FOUNDING_SPARKS = intEnv("FOUNDING_SPARKS", 500, 0, 100_000);

const STARTER_CAMPAIGNS = [
  { slug: "missouri", name: "Missouri", cities: ["St. Louis", "Kansas City", "Springfield", "Columbia", "Independence", "Jefferson City", "Cape Girardeau", "Joplin"] },
  { slug: "illinois", name: "Illinois", cities: ["Chicago", "Springfield", "Peoria", "Rockford", "Champaign", "Bloomington", "Belleville", "Carbondale"] },
  { slug: "tennessee", name: "Tennessee", cities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Jackson", "Johnson City"] },
  { slug: "kentucky", name: "Kentucky", cities: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington", "Paducah", "Frankfort", "Richmond"] },
];

export async function initCampaigns() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS campaigns (
      slug       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      cities     TEXT NOT NULL DEFAULT '[]',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaign_signups (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      campaign   TEXT NOT NULL,
      founding   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_signups_campaign ON campaign_signups(campaign, founding);
  `);
  // Seed once, on an empty table only, so a campaign an admin changes stays changed.
  if (Number((await kq.count.get()).c) === 0) {
    for (const c of STARTER_CAMPAIGNS) await kq.insert.run(c.slug, c.name, JSON.stringify(c.cities));
  }
}

const kq = {
  count: db.prepare("SELECT COUNT(*) AS c FROM campaigns"),
  insert: db.prepare("INSERT INTO campaigns (slug, name, cities) VALUES (?, ?, ?)"),
  all: db.prepare("SELECT * FROM campaigns ORDER BY name"),
  bySlug: db.prepare("SELECT * FROM campaigns WHERE slug = ?"),
  update: db.prepare("UPDATE campaigns SET name = ?, cities = ?, active = ? WHERE slug = ?"),
  // The founding flag is decided inside the insert, so two sign-ups at the
  // same moment can't both take the last spot.
  join: db.prepare(`
    INSERT INTO campaign_signups (user_id, campaign, founding)
    VALUES (?, ?, CASE WHEN (SELECT COUNT(*) FROM campaign_signups WHERE campaign = ? AND founding = 1) < ? THEN 1 ELSE 0 END)
  `),
  signupOf: db.prepare("SELECT * FROM campaign_signups WHERE user_id = ?"),
  foundingCount: db.prepare("SELECT COUNT(*) AS c FROM campaign_signups WHERE campaign = ? AND founding = 1"),
  stats: db.prepare(`
    SELECT campaign,
           COUNT(*) AS joined,
           SUM(founding) AS founding,
           SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week,
           SUM(CASE WHEN created_at > datetime('now', '-1 days') THEN 1 ELSE 0 END) AS day
    FROM campaign_signups GROUP BY campaign
  `),
};

const cleanSlug = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
const oneLine = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const citiesOf = (row) => {
  try {
    const list = JSON.parse(row.cities || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const cleanCities = (raw) => [...new Set((Array.isArray(raw) ? raw : []).map((c) => oneLine(c, 40)).filter(Boolean))].slice(0, 40);

const offer = (foundingTaken) => ({
  premiumDays: FOUNDING_PREMIUM_DAYS,
  sparks: FOUNDING_SPARKS,
  limit: FOUNDING_MEMBER_LIMIT,
  left: Math.max(0, FOUNDING_MEMBER_LIMIT - foundingTaken),
});

// Called right after a new account is created. Never blocks a sign-up: an
// unknown or paused campaign is simply ignored. Returns what the member got.
export async function applyCampaign(newUserId, rawSlug, { q }) {
  try {
    const slug = cleanSlug(rawSlug);
    if (!slug) return null;
    const campaign = await kq.bySlug.get(slug);
    if (!campaign || !campaign.active) return null;
    await kq.join.run(newUserId, slug, slug, FOUNDING_MEMBER_LIMIT);
    const founding = !!(await kq.signupOf.get(newUserId))?.founding;
    if (founding) {
      if (FOUNDING_PREMIUM_DAYS > 0) await q.extendPremium.run(FOUNDING_PREMIUM_DAYS, newUserId);
      if (FOUNDING_SPARKS > 0) await q.addSparks.run(FOUNDING_SPARKS, newUserId);
    }
    return {
      campaign: slug,
      name: campaign.name,
      founding,
      premiumDays: founding ? FOUNDING_PREMIUM_DAYS : 0,
      sparks: founding ? FOUNDING_SPARKS : 0,
    };
  } catch (err) {
    console.error("campaign sign-up not recorded:", err);
    return null;
  }
}

export function registerCampaignRoutes(app, { auth, adminOnly }) {
  const publicView = async (row) => ({
    slug: row.slug,
    name: row.name,
    cities: citiesOf(row),
    offer: offer(Number((await kq.foundingCount.get(row.slug)).c)),
  });

  // What a campaign page needs. No member counts beyond founding spots left.
  app.get("/api/public/campaigns", async (req, res) => {
    const rows = (await kq.all.all()).filter((r) => r.active);
    res.json({ campaigns: await Promise.all(rows.map(publicView)) });
  });

  app.get("/api/public/campaigns/:slug", async (req, res) => {
    const row = await kq.bySlug.get(cleanSlug(req.params.slug));
    if (!row || !row.active) return res.status(404).json({ error: "We're not there yet." });
    res.json({ campaign: await publicView(row) });
  });

  // The signed-in member's own campaign, for a "founding member" note.
  app.get("/api/me/campaign", auth, async (req, res) => {
    const s = await kq.signupOf.get(req.userId);
    const row = s ? await kq.bySlug.get(s.campaign) : null;
    res.json({ campaign: s ? { slug: s.campaign, name: row?.name || s.campaign, founding: !!s.founding } : null });
  });

  // How each campaign is doing.
  app.get("/api/admin/campaigns", auth, adminOnly, async (req, res) => {
    const stats = Object.fromEntries((await kq.stats.all()).map((s) => [s.campaign, s]));
    res.json({
      limit: FOUNDING_MEMBER_LIMIT,
      offer: { premiumDays: FOUNDING_PREMIUM_DAYS, sparks: FOUNDING_SPARKS },
      campaigns: (await kq.all.all()).map((row) => {
        const s = stats[row.slug] || {};
        return {
          slug: row.slug,
          name: row.name,
          cities: citiesOf(row),
          active: !!row.active,
          joined: Number(s.joined) || 0,
          founding: Number(s.founding) || 0,
          lastDay: Number(s.day) || 0,
          lastWeek: Number(s.week) || 0,
        };
      }),
    });
  });

  app.post("/api/admin/campaigns", auth, adminOnly, async (req, res) => {
    const name = oneLine(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: "Give the campaign a place name." });
    const slug = cleanSlug(name.replace(/\s+/g, "-"));
    if (!slug) return res.status(400).json({ error: "Use letters or numbers in the name." });
    if (await kq.bySlug.get(slug)) return res.status(409).json({ error: "There's already a campaign for that place." });
    await kq.insert.run(slug, name, JSON.stringify(cleanCities(req.body?.cities)));
    res.json({ ok: true, slug });
  });

  // Rename, change the cities, or pause and resume.
  app.put("/api/admin/campaigns/:slug", auth, adminOnly, async (req, res) => {
    const row = await kq.bySlug.get(cleanSlug(req.params.slug));
    if (!row) return res.status(404).json({ error: "No such campaign." });
    const b = req.body || {};
    const name = b.name !== undefined ? oneLine(b.name, 60) : row.name;
    if (!name) return res.status(400).json({ error: "Give the campaign a place name." });
    const cities = b.cities !== undefined ? JSON.stringify(cleanCities(b.cities)) : row.cities;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : row.active;
    await kq.update.run(name, cities, active, row.slug);
    res.json({ ok: true });
  });
}
