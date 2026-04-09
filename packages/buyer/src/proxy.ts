/**
 * MCP Payment Proxy — transparent x402 payment handling.
 *
 * Sits between any standard MCP client and a paid MCP server.
 * Clients connect to this proxy instead of the seller directly;
 * the proxy intercepts 402 responses, creates payments via the
 * Ampersend Treasurer, and retries transparently.
 *
 * Usage:
 *   BUYER_SMART_ACCOUNT_ADDRESS=0x... \
 *   BUYER_SESSION_KEY_PRIVATE_KEY=0x... \
 *   pnpm --filter @poc/buyer proxy
 *
 * Then connect MCP clients to:
 *   http://localhost:8402/mcp?target=http://localhost:8000/mcp
 */
import "dotenv/config";
import { createAmpersendProxy } from "@ampersend_ai/ampersend-sdk";
import type { Address, Hex } from "viem";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8402);

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

  console.log("[proxy] Starting MCP payment proxy");
  console.log(`[proxy] Smart account: ${smartAccountAddress}`);

  const { server } = await createAmpersendProxy({
    port: PROXY_PORT,
    smartAccountAddress,
    sessionKeyPrivateKey,
    apiUrl: process.env.AMPERSEND_API_URL ?? "https://api.ampersend.ai",
    chainId: process.env.CHAIN_NETWORK === "base" ? 8453 : 84532,
  });

  console.log(`[proxy] Listening on http://localhost:${PROXY_PORT}`);
  console.log(
    `[proxy] Connect clients to: http://localhost:${PROXY_PORT}/mcp?target=http://localhost:8000/mcp`,
  );
  console.log("[proxy] Press Ctrl+C to stop\n");

  process.on("SIGINT", async () => {
    console.log("\n[proxy] Shutting down...");
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
