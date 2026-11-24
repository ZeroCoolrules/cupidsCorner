// Run with: npm --workspace server test
// Uses a throwaway database and a stand-in for Google, so nothing real is charged.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "play-test-"));
process.env.DB_PATH = path.join(dir, "test.sqlite");
delete process.env.DATABASE_URL;

const { db, initDb } = await import("./db.js");
const play = await import("./playBilling.js");

let server, base;
let google = {}; // token -> Google's record
let consumed = [];
let failConsume = false;
let lookups = 0;

const fakeClient = {
  async getPurchase(productId, token) {
    lookups += 1;
    return google[token] ?? null;
  },
  async consume(productId, token) {
    if (failConsume) throw new Error("boom");
    consumed.push(token);
  },
};

const q = {
  profileById: db.prepare("SELECT * FROM profiles WHERE user_id = ?"),
  addSparks: db.prepare("UPDATE profiles SET sparks = sparks + ? WHERE user_id = ?"),
};
const sparksOf = async (id) => (await q.profileById.get(id)).sparks;

async function call(userId, pathname, body) {
  const res = await fetch(base + pathname, {
    method: body ? "POST" : "GET",
    headers: { "x-user": String(userId), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  await initDb();
  await play.initPlayBilling();
  for (const name of ["ann", "bob"]) {
    const { lastInsertRowid } = await db.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(name);
    await db.prepare("INSERT INTO profiles (user_id, display_name, sparks) VALUES (?, ?, 0)").run(lastInsertRowid, name);
  }
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => ((req.userId = Number(req.get("x-user"))), next());
  const rateLimit = () => (req, res, next) => next();
  play.registerPlayBillingRoutes(app, { auth, q, rateLimit, getClient: () => fakeClient });
  await new Promise((ok) => (server = app.listen(0, ok)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("lists packs with Play product ids and a per-member token", async () => {
  const a = await call(1, "/api/billing/play");
  const b = await call(2, "/api/billing/play");
  assert.equal(a.body.configured, true);
  assert.deepEqual(a.body.packs.map((p) => p.productId), ["sparks_small", "sparks_medium", "sparks_large"]);
  assert.match(a.body.accountToken, /^[0-9a-f]{64}$/);
  assert.notEqual(a.body.accountToken, b.body.accountToken);
});

test("a paid purchase adds sparks once, however often it is sent", async () => {
  google.tokA = { purchaseState: 0, consumptionState: 0, orderId: "GPA.1", obfuscatedExternalAccountId: play.playAccountToken(1) };
  const first = await call(1, "/api/billing/play/redeem", { productId: "sparks_small", purchaseToken: "tokA" });
  assert.equal(first.status, 200);
  assert.equal(first.body.added, 500);
  assert.equal(await sparksOf(1), 500);
  assert.deepEqual(consumed, ["tokA"]);

  const again = await call(1, "/api/billing/play/redeem", { productId: "sparks_small", purchaseToken: "tokA" });
  assert.equal(again.body.added, 0);
  assert.equal(again.body.alreadyCounted, true);
  assert.equal(await sparksOf(1), 500);
});

test("two requests racing on one token count it once", async () => {
  google.tokRace = { purchaseState: 0, consumptionState: 0, orderId: "GPA.2" };
  const results = await Promise.all(
    [1, 2, 3, 4].map(() => call(1, "/api/billing/play/redeem", { productId: "sparks_medium", purchaseToken: "tokRace" }))
  );
  assert.equal(results.reduce((n, r) => n + r.body.added, 0), 1200);
  assert.equal(await sparksOf(1), 1700);
});

test("another member cannot claim someone else's purchase", async () => {
  // Already counted for member 1.
  const stolen = await call(2, "/api/billing/play/redeem", { productId: "sparks_small", purchaseToken: "tokA" });
  assert.equal(stolen.status, 409);
  // Not yet counted, but Google says member 1 started it.
  google.tokB = { purchaseState: 0, consumptionState: 0, obfuscatedExternalAccountId: play.playAccountToken(1) };
  const wrong = await call(2, "/api/billing/play/redeem", { productId: "sparks_small", purchaseToken: "tokB" });
  assert.equal(wrong.status, 409);
  assert.equal(await sparksOf(2), 0);
});

test("unknown, cancelled, pending and used-up purchases add nothing", async () => {
  google.cancelled = { purchaseState: 1 };
  google.pending = { purchaseState: 2 };
  google.used = { purchaseState: 0, consumptionState: 1 };
  const cases = { nope: 400, cancelled: 400, pending: 202, used: 400 };
  for (const [token, status] of Object.entries(cases)) {
    const r = await call(2, "/api/billing/play/redeem", { productId: "sparks_large", purchaseToken: token });
    assert.equal(r.status, status, token);
  }
  assert.equal((await call(2, "/api/billing/play/redeem", { productId: "gems_1", purchaseToken: "x" })).status, 400);
  assert.equal((await call(2, "/api/billing/play/redeem", { productId: "sparks_small" })).status, 400);
  assert.equal(await sparksOf(2), 0);
});

test("if telling Google fails, sparks still count once and the retry finishes the job", async () => {
  google.tokC = { purchaseState: 0, consumptionState: 0 };
  failConsume = true;
  const first = await call(2, "/api/billing/play/redeem", { productId: "sparks_large", purchaseToken: "tokC" });
  assert.equal(first.body.added, 3000);
  assert.ok(!consumed.includes("tokC"));
  failConsume = false;
  const retry = await call(2, "/api/billing/play/redeem", { productId: "sparks_large", purchaseToken: "tokC" });
  assert.equal(retry.body.added, 0);
  assert.ok(consumed.includes("tokC"));
  assert.equal(await sparksOf(2), 3000);
});

test("the Google client signs in with the service account and reuses the sign-in", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      const assertion = new URLSearchParams(init.body).get("assertion");
      const [h, p, sig] = assertion.split(".");
      assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, "base64url")));
      const claims = JSON.parse(Buffer.from(p, "base64url").toString());
      assert.equal(claims.iss, "svc@example.iam.gserviceaccount.com");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/androidpublisher");
      return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
    }
    assert.equal(init.headers.authorization, "Bearer at");
    if (url.endsWith(":consume")) return new Response("{}", { status: 200 });
    if (url.includes("/tokens/missing")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ purchaseState: 0 }), { status: 200 });
  };
  const client = play.createPlayClient({
    credentials: { clientEmail: "svc@example.iam.gserviceaccount.com", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) },
    packageName: "com.example.app",
    fetchImpl,
  });
  assert.deepEqual(await client.getPurchase("sparks_small", "tok/1"), { purchaseState: 0 });
  assert.equal(await client.getPurchase("sparks_small", "missing"), null);
  await client.consume("sparks_small", "tok/1");
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1);
  assert.equal(
    calls[1].url,
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app/purchases/products/sparks_small/tokens/tok%2F1"
  );
});
