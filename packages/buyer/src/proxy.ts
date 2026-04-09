/**
 * MCP Payment Proxy — transparent x402 payment handling with AgentCore wallet.
 *
 * Sits between any standard MCP client and a paid MCP server.
 * Uses the AgentCore wallet provider for payment signing.
 *
 * Usage:
 *   CDP_API_KEY_ID=... CDP_API_KEY_SECRET=... pnpm --filter @poc/buyer proxy
 *   # or
 *   BUYER_PRIVATE_KEY=0x... pnpm --filter @poc/buyer proxy
 *
 * Then connect MCP clients to:
 *   http://localhost:8402/mcp?target=http://localhost:8000/mcp
 */
import "dotenv/config";
import { initializeProxyServer } from "@ampersend_ai/ampersend-sdk";
import { createAgentCoreWallet } from "./agentcore-wallet.js";

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8402);

async function main() {
  const walletProvider = await createAgentCoreWallet();
  console.log(`[proxy] AgentCore wallet: ${walletProvider.getAddress()} (${walletProvider.getMode()} mode)`);

  const treasurer = walletProvider.createNaiveTreasurer();

  const { server } = await initializeProxyServer({
    transport: { port: PROXY_PORT },
    treasurer,
  } as any);

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
