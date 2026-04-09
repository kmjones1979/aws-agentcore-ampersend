/**
 * HTTP Buyer — x402-enabled fetch client with AgentCore wallet.
 *
 * Demonstrates making paid HTTP requests using the AgentCore wallet
 * for payment signing. The ampersend-sdk wraps standard fetch with
 * automatic x402 payment handling.
 *
 * Usage:
 *   CDP_API_KEY_ID=... CDP_API_KEY_SECRET=... pnpm --filter @poc/buyer http
 *   # or
 *   BUYER_PRIVATE_KEY=0x... pnpm --filter @poc/buyer http
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname, "../../../.env") });
import {
  wrapWithAmpersend,
} from "@ampersend_ai/ampersend-sdk/x402";
import { createAgentCoreWallet } from "./agentcore-wallet.js";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

async function main() {
  const walletProvider = await createAgentCoreWallet();
  console.log(`[http-buyer] AgentCore wallet: ${walletProvider.getAddress()} (${walletProvider.getMode()} mode)`);

  const network =
    (process.env.CHAIN_NETWORK as "base-sepolia" | "base") ?? "base-sepolia";

  const treasurer = walletProvider.createNaiveTreasurer();
  const client = new x402Client();
  wrapWithAmpersend(client, treasurer, [network]);
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const targetUrl =
    process.env.PAID_HTTP_URL ?? "https://paid-api.example.com/resource";

  console.log(`\n[http-buyer] Fetching ${targetUrl}`);
  try {
    const response = await fetchWithPay(targetUrl);
    const body = await response.text();
    console.log("[http-buyer] Status:", response.status);
    console.log("[http-buyer] Body:", body.slice(0, 500));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      "[http-buyer] Expected error (no real paid endpoint configured):",
      msg,
    );
    console.log(
      "\nTo test: set PAID_HTTP_URL to an x402-enabled HTTP endpoint.",
    );
  }

  console.log("\n[http-buyer] Done.");
}

main().catch(console.error);
