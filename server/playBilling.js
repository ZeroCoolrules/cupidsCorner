// Buying sparks inside the Android app with Google Play Billing.
//
// The app shows Google's own purchase sheet. When the member pays, the app
// gets a "purchase token" and sends it here. This file asks Google whether
// that token is a real, paid purchase, adds the sparks once, and then tells
// Google the purchase is used up so the same pack can be bought again.
// Sparks are never added on the app's word alone.
//
// Optional, like Stripe: without the settings below the app just says buying
// isn't open yet.
//
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  the service account key file's contents
//                                     (raw JSON or base64 of it). The account
//                                     needs "View financial data" and "Manage
//                                     orders" on the app in Play Console.
//   GOOGLE_PLAY_PACKAGE_NAME          the app id (default xyz.qupidlist.qpidsplace)
//
// Each spark pack needs a one-time product in Play Console whose product ID
// is "sparks_" plus the pack key: sparks_small, sparks_medium, sparks_large.

import crypto from "node:crypto";
import { db } from "./db.js";
import { SPARK_PACKS } from "./billing.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export const PLAY_PRODUCT_PREFIX = "sparks_";
export const playProductId = (packKey) => `${PLAY_PRODUCT_PREFIX}${packKey}`;
const PACK_BY_PRODUCT = Object.fromEntries(SPARK_PACKS.map((p) => [playProductId(p.key), p]));

export const playPackageName = () =>
  String(process.env.GOOGLE_PLAY_PACKAGE_NAME || "xyz.qupidlist.qpidsplace").trim();

function readCredentials() {
  const raw = String(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text);
    if (!json.client_email || !json.private_key) return null;
    return { clientEmail: json.client_email, privateKey: json.private_key };
  } catch {
    return null;
  }
}

export const isPlayBillingConfigured = () => !!readCredentials();

// Ties a purchase to the member who started it without giving Google the
// member's id. The app passes this to Google with the purchase and Google
// hands it back when we look the purchase up.
export function playAccountToken(userId) {
  return crypto.createHash("sha256").update(`cupid-play:${playPackageName()}:${userId}`).digest("hex");
}

const b64url = (input) => Buffer.from(input).toString("base64url");

// Talks to Google. `fetchImpl` is passed in so tests can stand in for Google.
export function createPlayClient({ credentials, packageName, fetchImpl = fetch, now = () => Date.now() }) {
  let cached = null; // { token, expiresAt }

  async function accessToken() {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({ iss: credentials.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })
    )}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credentials.privateKey).toString("base64url");
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed (${res.status})`);
    cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
    return cached.token;
  }

  const purchaseUrl = (productId, token) =>
    `${API_BASE}/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(
      productId
    )}/tokens/${encodeURIComponent(token)}`;

  return {
    // Returns Google's record of the purchase, or null when Google has no
    // such purchase for this app and product.
    async getPurchase(productId, token) {
      const res = await fetchImpl(purchaseUrl(productId, token), {
        headers: { authorization: `Bearer ${await accessToken()}` },
      });
      if (res.status === 400 || res.status === 404 || res.status === 410) return null;
      if (!res.ok) throw new Error(`Google Play lookup failed (${res.status})`);
      return res.json();
    },
    async consume(productId, token) {
      const res = await fetchImpl(`${purchaseUrl(productId, token)}:consume`, {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}` },
      });
      if (!res.ok) throw new Error(`Google Play consume failed (${res.status})`);
    },
  };
}

let defaultClient = null;
function getDefaultClient() {
  const credentials = readCredentials();
  if (!credentials) return null;
  if (!defaultClient) defaultClient = createPlayClient({ credentials, packageName: playPackageName() });
  return defaultClient;
}

export async function initPlayBilling() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS play_purchases (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_token TEXT NOT NULL UNIQUE,
      order_id       TEXT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id     TEXT NOT NULL,
      sparks         INTEGER NOT NULL,
      test_purchase  INTEGER NOT NULL DEFAULT 0,
      consumed_at    TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_play_purchases_user ON play_purchases(user_id, id);
  `);
}

const pq = {
  byToken: db.prepare("SELECT * FROM play_purchases WHERE purchase_token = ?"),
  // The UNIQUE token makes this the one place a purchase can be counted.
  record: db.prepare(`
    INSERT INTO play_purchases (purchase_token, order_id, user_id, product_id, sparks, test_purchase)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (purchase_token) DO NOTHING
  `),
  markConsumed: db.prepare("UPDATE play_purchases SET consumed_at = datetime('now') WHERE purchase_token = ? AND consumed_at IS NULL"),
};

// `getClient` is for tests; the live server uses the settings above.
export function registerPlayBillingRoutes(app, { auth, q, rateLimit, getClient = getDefaultClient }) {
  // Members reach the server through the site's proxy, so many share one
  // address; the limit is set with that in mind.
  const redeemLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 200,
    message: "Too many purchase checks. Try again in a few minutes.",
  });

  // What the app needs to show Google's purchase sheet.
  app.get("/api/billing/play", auth, (req, res) => {
    res.json({
      configured: !!getClient(),
      accountToken: playAccountToken(req.userId),
      packs: SPARK_PACKS.map((p) => ({ ...p, productId: playProductId(p.key) })),
    });
  });

  // The app sends each purchase token here. Safe to call again with the same
  // token: sparks are added once.
  app.post("/api/billing/play/redeem", auth, redeemLimiter, async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Buying sparks in the app isn't open yet." });

    const productId = String(req.body?.productId || "");
    const token = String(req.body?.purchaseToken || "");
    const pack = PACK_BY_PRODUCT[productId];
    if (!pack) return res.status(400).json({ error: "unknown product" });
    if (!token || token.length > 2000) return res.status(400).json({ error: "missing purchase" });

    const finish = async (row, added) => {
      const me = await q.profileById.get(req.userId);
      res.json({ ok: true, added, sparks: me.sparks, pack: pack.key, alreadyCounted: !added, pending: false });
    };
    const consume = async () => {
      try {
        await client.consume(productId, token);
        await pq.markConsumed.run(token);
      } catch (err) {
        // The sparks are already recorded. The app sends the token again the
        // next time the Sparks page opens, and that retry lands here.
        console.error("play consume failed:", err.message);
      }
    };

    const seen = await pq.byToken.get(token);
    if (seen) {
      if (seen.user_id !== req.userId) return res.status(409).json({ error: "This purchase belongs to another account." });
      if (!seen.consumed_at) await consume();
      return finish(seen, 0);
    }

    let purchase;
    try {
      purchase = await client.getPurchase(productId, token);
    } catch (err) {
      console.error("play lookup failed:", err.message);
      return res.status(502).json({ error: "Couldn't reach Google Play to confirm the purchase. Your purchase is safe; try again in a moment." });
    }
    if (!purchase) return res.status(400).json({ error: "Google Play doesn't recognise this purchase." });
    // 0 = paid, 1 = cancelled, 2 = pending (for example, paying cash at a shop).
    if (purchase.purchaseState === 2) {
      return res.status(202).json({ ok: false, pending: true, added: 0, message: "Your payment is still pending. Sparks arrive once it clears." });
    }
    if (purchase.purchaseState !== 0) return res.status(400).json({ error: "This purchase was cancelled or refunded." });
    if (purchase.obfuscatedExternalAccountId && purchase.obfuscatedExternalAccountId !== playAccountToken(req.userId)) {
      return res.status(409).json({ error: "This purchase belongs to another account." });
    }
    // Already used up at Google but unknown here: not ours to count.
    if (purchase.consumptionState === 1) return res.status(400).json({ error: "This purchase has already been used." });

    const quantity = Math.max(1, Math.min(10, Math.round(Number(purchase.quantity) || 1)));
    const sparks = pack.sparks * quantity;
    const inserted = await pq.record.run(token, purchase.orderId || null, req.userId, productId, sparks, purchase.purchaseType === 0 ? 1 : 0);
    if (inserted.changes === 0) {
      // Two requests raced on the same token; the other one counted it.
      const row = await pq.byToken.get(token);
      if (row && row.user_id !== req.userId) return res.status(409).json({ error: "This purchase belongs to another account." });
      return finish(row, 0);
    }
    await q.addSparks.run(sparks, req.userId);
    await consume();
    return finish(null, sparks);
  });
}
