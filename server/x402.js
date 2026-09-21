// x402 pay-per-call gate for the public POST /match/compatibility endpoint,
// declared for discovery in the CDP Bazaar.
//
// Off unless X402_PAY_TO is set (the wallet that receives the USDC), so the
// app runs unchanged without it.
//
//   X402_PAY_TO          0x... wallet address that receives payments
//   X402_PRICE           default "$0.001" (1000 atomic USDC; the minimum for the Bazaar)
//   X402_NETWORK         eip155:8453 (Base, default) | eip155:84532 (Base Sepolia)
//   X402_PUBLIC_URL      public origin, e.g. https://cupidscorner.onrender.com, so the
//                        402 "resource.url" is exact regardless of proxy headers
//   CDP_API_KEY_ID /     Coinbase CDP API key. Required for the CDP facilitator, which
//   CDP_API_KEY_SECRET   is the only one that catalogs endpoints in the Bazaar
//   X402_FACILITATOR_URL only used when no CDP key is set (e.g. x402.org, testnet only;
//                        such endpoints are NOT cataloged in the CDP Bazaar)

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { facilitator as cdpFacilitator } from "@coinbase/x402";

export const COMPAT_ROUTE = "/match/compatibility";

const DESCRIPTION =
  "Send two dating profiles (name, age, bio, interests, what they're looking for). " +
  "Returns a 0-100 compatibility score, a short list of reasons (shared interests, " +
  "complementary traits, potential friction), and one suggested icebreaker.";

const profileExample = (name, age, bio, interests) => ({
  name,
  age,
  bio,
  interests,
  lookingFor: "long-term",
});

const profileSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer", minimum: 18 },
    bio: { type: "string" },
    interests: { type: "array", items: { type: "string" } },
    lookingFor: { type: "string" },
  },
  required: ["age"],
};

export function isX402Configured() {
  return /^0x[0-9a-fA-F]{40}$/.test(process.env.X402_PAY_TO || "");
}

function hasCdpKeys() {
  return Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
}

function makeFacilitator() {
  if (hasCdpKeys()) return new HTTPFacilitatorClient(cdpFacilitator);
  console.warn(
    "[x402] CDP_API_KEY_ID/CDP_API_KEY_SECRET not set: using a non-CDP facilitator. " +
      "This endpoint will NOT be cataloged in the CDP Bazaar.",
  );
  return new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  });
}

export function x402Gate() {
  const network = process.env.X402_NETWORK || "eip155:8453";
  const publicUrl = (process.env.X402_PUBLIC_URL || "").replace(/\/+$/, "");

  const resourceServer = new x402ResourceServer(makeFacilitator())
    .register(network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  const discovery = declareDiscoveryExtension({
    method: "POST",
    bodyType: "json",
    input: {
      profileA: profileExample("Sam", 29, "Hiker, coffee nerd", ["hiking", "coffee", "jazz"]),
      profileB: profileExample("Alex", 31, "Climber, loves cooking", ["climbing", "cooking", "jazz"]),
    },
    inputSchema: {
      type: "object",
      properties: { profileA: profileSchema, profileB: profileSchema },
      required: ["profileA", "profileB"],
    },
    output: {
      example: {
        score: 82,
        reasons: [
          "Both want a long-term relationship",
          "Shared love of jazz",
          "Both are outdoorsy, so activity dates come easily",
        ],
        friction: ["Different cooking/coffee routines may need some compromise"],
        icebreaker: "Jazz and hiking? What's the best trail you've done with a good playlist?",
      },
      schema: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          reasons: { type: "array", items: { type: "string" } },
          friction: { type: "array", items: { type: "string" } },
          icebreaker: { type: "string" },
        },
        required: ["score", "reasons", "friction", "icebreaker"],
      },
    },
  });

  return paymentMiddleware(
    {
      [`POST ${COMPAT_ROUTE}`]: {
        accepts: {
          scheme: "exact",
          price: process.env.X402_PRICE || "$0.001",
          network,
          payTo: process.env.X402_PAY_TO,
        },
        ...(publicUrl && { resource: `${publicUrl}${COMPAT_ROUTE}` }),
        description: DESCRIPTION,
        mimeType: "application/json",
        extensions: { ...discovery },
      },
    },
    resourceServer,
  );
}
