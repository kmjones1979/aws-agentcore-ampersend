/**
 * HTTP Buyer — x402-enabled fetch client.
 *
 * Demonstrates making paid HTTP requests using the x402 fetch wrapper
 * with Ampersend smart account credentials. Any standard HTTP endpoint
 * that returns 402 + x402 payment requirements will be handled
 * automatically.
 *
 * Usage:
 *   BUYER_SMART_ACCOUNT_ADDRESS=0x... \
 *   BUYER_SESSION_KEY_PRIVATE_KEY=0x... \
 *   pnpm --filter @poc/buyer http
 */
import "dotenv/config";
import { createAmpersendHttpClient } from "@ampersend_ai/ampersend-sdk";
import type { Address, Hex } from "viem";

async function main() {
  const smartAccountAddress = process.env.BUYER_SMART_ACCOUNT_ADDRESS as
    | Address
    | undefined;
  const sessionKeyPrivateKey = process.env.BUYER_SESSION_KEY_PRIVATE_KEY as
    | Hex
    | undefined;

  if (!smartAccountAddress || !sessionKeyPrivateKey) {
    console.error(
      "Set BUYER_SMART_ACCOUNT_ADDRESS and BUYER_SESSION_KEY_PRIVATE_KEY in .env",
    );
    process.exit(1);
  }

  const network =
    (process.env.CHAIN_NETWORK as "base-sepolia" | "base") ?? "base-sepolia";

  console.log("[http-buyer] Creating x402 HTTP client");
  console.log(`[http-buyer] Smart account: ${smartAccountAddress}`);
  console.log(`[http-buyer] Network: ${network}`);

  const client = createAmpersendHttpClient({
    smartAccountAddress,
    sessionKeyPrivateKey,
    apiUrl: process.env.AMPERSEND_API_URL ?? "https://api.ampersend.ai",
    network,
  });

  // Dynamically import @x402/fetch (peer dependency of ampersend-sdk)
  const { wrapFetchWithPayment } = await import("@x402/fetch");

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  // Example: call a paid HTTP endpoint (the seller also listens on /mcp,
  // but for HTTP x402 demos you'd point at any x402-enabled REST API).
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
