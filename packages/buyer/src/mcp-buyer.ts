/**
 * Ampersend MCP Buyer — production pattern with spend limits.
 *
 * Uses createAmpersendMcpClient with AmpersendTreasurer which
 * authorizes payments through the Ampersend API before signing.
 * Requires a smart account set up via `ampersend setup`.
 *
 * Usage:
 *   BUYER_SMART_ACCOUNT_ADDRESS=0x... \
 *   BUYER_SESSION_KEY_PRIVATE_KEY=0x... \
 *   pnpm --filter @poc/buyer mcp
 */
import "dotenv/config";
import { createAmpersendMcpClient } from "@ampersend_ai/ampersend-sdk";
import { StreamableHTTPClientTransport } from "@ampersend_ai/ampersend-sdk/mcp/client";
import type { Address, Hex } from "viem";

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

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

  console.log(`[mcp-buyer] Connecting to seller at ${SELLER_URL}`);
  console.log(`[mcp-buyer] Smart account: ${smartAccountAddress}`);

  const client = createAmpersendMcpClient({
    clientInfo: { name: "mcp-buyer", version: "1.0.0" },
    smartAccountAddress,
    sessionKeyPrivateKey,
    apiUrl: process.env.AMPERSEND_API_URL ?? "https://api.ampersend.ai",
    chainId: process.env.CHAIN_NETWORK === "base" ? 8453 : 84532,
  });

  const transport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await client.connect(transport);
  console.log("[mcp-buyer] Connected (AmpersendTreasurer)\n");

  // List tools
  const { tools } = await client.listTools();
  console.log(
    "[mcp-buyer] Available tools:",
    tools.map((t) => t.name),
  );

  // Call research_topic — treasurer will check spend limits before paying
  console.log("\n--- Calling research_topic (spend-limited) ---");
  try {
    const result = await client.callTool({
      name: "research_topic",
      arguments: { topic: "autonomous agent payments", depth: "brief" },
    });
    console.log("[mcp-buyer] Result:", JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mcp-buyer] Error (may be spend limit):", msg);
  }

  // Call generate_code
  console.log("\n--- Calling generate_code (spend-limited) ---");
  try {
    const result = await client.callTool({
      name: "generate_code",
      arguments: {
        description: "An ERC-20 token contract with mint and burn",
        language: "solidity",
      },
    });
    console.log("[mcp-buyer] Result:", JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mcp-buyer] Error (may be spend limit):", msg);
  }

  await client.close();
  console.log("\n[mcp-buyer] Done.");
}

main().catch(console.error);
