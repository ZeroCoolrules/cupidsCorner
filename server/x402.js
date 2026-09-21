// x402 pay-per-call gate for the public /match/compatibility endpoint.
//
// Off unless X402_PAY_TO is set (the wallet that receives the USDC), so the
// app runs unchanged without it. Defaults to Base Sepolia (testnet) so real
// money is never charged until you opt in with X402_NETWORK=eip155:8453.
//
//   X402_PAY_TO          0x... wallet address that receives payments
//   X402_PRICE           default "$0.01"
//   X402_NETWORK         eip155:84532 (Base Sepolia, default) | eip155:8453 (Base mainnet)
//   X402_FACILITATOR_URL default https://x402.org/facilitator (testnet only;
//                        mainnet needs a mainnet-capable facilitator such as Coinbase CDP)

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

export const COMPAT_ROUTE = "/match/compatibility";

export function isX402Configured() {
  return /^0x[0-9a-fA-F]{40}$/.test(process.env.X402_PAY_TO || "");
}

export function x402Gate() {
  const network = process.env.X402_NETWORK || "eip155:84532";
  const facilitator = new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    network,
    new ExactEvmScheme(),
  );

  return paymentMiddleware(
    {
      [`POST ${COMPAT_ROUTE}`]: {
        accepts: {
          scheme: "exact",
          price: process.env.X402_PRICE || "$0.01",
          network,
          payTo: process.env.X402_PAY_TO,
        },
        description:
          "Compatibility score (0-100), reasons, friction points and an icebreaker for two dating profiles.",
        mimeType: "application/json",
      },
    },
    resourceServer,
  );
}
