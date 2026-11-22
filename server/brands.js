// Brands — one backend, many white-label sites.
//
// Every site (Cupid's Corner itself, the new web site, partner sites) is a
// row in `brands`. A request is matched to a brand by the X-Brand header (a
// slug, sent by a separate front end) or by the Host it arrived on (a
// partner's own domain); anything else is the default brand.
//
// Members are one shared pool: a brand changes the look and where a member
// signed up (users.brand_id), never who they can see or match.

import { db } from "./db.js";

export const DEFAULT_BRAND_SLUG = "cupidscorner";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// Domain names only: no scheme, port, path or wildcards.
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function initBrands() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS brands (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      domain        TEXT UNIQUE,
      logo_url      TEXT,
      primary_color TEXT NOT NULL DEFAULT '#7c3aed',
      accent_color  TEXT NOT NULL DEFAULT '#a855f7',
      support_email TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await db.prepare(
    "INSERT INTO brands (slug, name) VALUES (?, ?) ON CONFLICT (slug) DO NOTHING"
  ).run(DEFAULT_BRAND_SLUG, "Cupid's Corner");

  // Where each member signed up. Existing members belong to the default brand.
  if (!(await db.columns("users")).includes("brand_id")) {
    await db.exec("ALTER TABLE users ADD COLUMN brand_id INTEGER REFERENCES brands(id)");
  }
  await db.prepare(
    "UPDATE users SET brand_id = (SELECT id FROM brands WHERE slug = ?) WHERE brand_id IS NULL"
  ).run(DEFAULT_BRAND_SLUG);
}

const bySlug = () => db.prepare("SELECT * FROM brands WHERE slug = ? AND active = 1");
const byDomain = () => db.prepare("SELECT * FROM brands WHERE domain = ? AND active = 1");

export function defaultBrand() {
  return db.prepare("SELECT * FROM brands WHERE slug = ?").get(DEFAULT_BRAND_SLUG);
}

export function listBrands() {
  return db.prepare("SELECT * FROM brands ORDER BY id").all();
}

// Origins (https://domain) of active brands, for CORS.
export async function brandOrigins() {
  return (await db.prepare("SELECT domain FROM brands WHERE domain IS NOT NULL AND active = 1").all()).flatMap((r) => [`https://${r.domain}`, `https://www.${r.domain}`]);
}

export async function resolveBrand(req) {
  const slug = String(req.get("x-brand") || "").trim().toLowerCase();
  if (slug) {
    const b = await bySlug().get(slug);
    if (b) return b;
  }
  const host = String(req.hostname || "").toLowerCase().replace(/^www\./, "");
  if (host) {
    const b = await byDomain().get(host);
    if (b) return b;
  }
  return defaultBrand();
}

export function brandMiddleware(req, res, next) {
  resolveBrand(req).then((b) => {
    req.brand = b;
    next();
  }, next);
}

export function publicBrand(b) {
  return {
    slug: b.slug,
    name: b.name,
    domain: b.domain || null,
    logoUrl: b.logo_url || null,
    primaryColor: b.primary_color,
    accentColor: b.accent_color,
    supportEmail: b.support_email || null,
  };
}

// Validates admin input. Returns { error } or { values } (only fields given).
export function brandInput(body, { creating }) {
  const v = {};
  const b = body || {};
  if (creating || b.slug !== undefined) {
    const slug = String(b.slug || "").trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return { error: "slug: 2-32 lowercase letters, numbers or dashes" };
    v.slug = slug;
  }
  if (creating || b.name !== undefined) {
    const name = String(b.name || "").trim();
    if (!name || name.length > 60) return { error: "name: 1-60 characters" };
    v.name = name;
  }
  if (b.domain !== undefined) {
    const domain = b.domain ? String(b.domain).trim().toLowerCase().replace(/^www\./, "") : null;
    if (domain && !DOMAIN_RE.test(domain)) return { error: "domain: a bare domain like example.com" };
    v.domain = domain;
  }
  if (b.logoUrl !== undefined) {
    const url = b.logoUrl ? String(b.logoUrl).trim() : null;
    if (url && !/^https:\/\/\S{1,500}$/.test(url)) return { error: "logoUrl: an https URL" };
    v.logo_url = url;
  }
  for (const [key, col] of [["primaryColor", "primary_color"], ["accentColor", "accent_color"]]) {
    if (b[key] !== undefined) {
      if (!HEX_RE.test(String(b[key]))) return { error: `${key}: a hex color like #7c3aed` };
      v[col] = String(b[key]);
    }
  }
  if (b.supportEmail !== undefined) {
    const email = b.supportEmail ? String(b.supportEmail).trim() : null;
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) return { error: "supportEmail: an email address" };
    v.support_email = email;
  }
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  return { values: v };
}

export async function createBrand(values) {
  const cols = Object.keys(values);
  const info = await db
    .prepare(`INSERT INTO brands (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...cols.map((c) => values[c]));
  return db.prepare("SELECT * FROM brands WHERE id = ?").get(Number(info.lastInsertRowid));
}

export async function updateBrand(slug, values) {
  const cols = Object.keys(values);
  if (cols.length) {
    await db.prepare(`UPDATE brands SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE slug = ?`).run(
      ...cols.map((c) => values[c]),
      slug
    );
  }
  return db.prepare("SELECT * FROM brands WHERE slug = ?").get(values.slug || slug);
}
