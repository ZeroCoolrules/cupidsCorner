// Stripe integration for buying sparks with real money. Optional — the app
// runs fine without it, the "Buy sparks" screen just explains it isn't
// configured yet (same pattern as server/stream.js).
//
//   STRIPE_SECRET_KEY=sk_test_...
//   STRIPE_WEBHOOK_SECRET=whsec_...   (from `stripe listen` or the dashboard)

import Stripe from "stripe";

let stripe = null;

export const SPARK_PACKS = [
  { key: "small", sparks: 500, price: 499, label: "500 sparks" },
  { key: "medium", sparks: 1200, price: 999, label: "1,200 sparks" },
  { key: "large", sparks: 3000, price: 1999, label: "3,000 sparks" },
];

export const PACK_BY_KEY = Object.fromEntries(SPARK_PACKS.map((p) => [p.key, p]));

export function isBillingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!isBillingConfigured()) return null;
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe;
}

export async function createCheckoutSession({ userId, packKey, successUrl, cancelUrl }) {
  const s = getStripe();
  if (!s) return null;
  const pack = PACK_BY_KEY[packKey];
  if (!pack) throw new Error("unknown pack");
  const session = await s.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Cupid's Corner — ${pack.label}` },
          unit_amount: pack.price,
        },
        quantity: 1,
      },
    ],
    metadata: { userId: String(userId), packKey },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session.url;
}

// Verifies + parses a Stripe webhook request. Throws on a bad signature.
export function constructWebhookEvent(rawBody, signature) {
  const s = getStripe();
  if (!s) return null;
  return s.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}
