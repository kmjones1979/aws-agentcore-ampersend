/**
 * Ampersend MCP Buyer — production pattern with AgentCore wallet + spend limits.
 *
 * Uses the AgentCore wallet provider for credential management, combined
 * with the AmpersendTreasurer for API-authorized, spend-limited payments.
 *
 * In production, the CDP wallet credentials would be stored in
 * AWS Secrets Manager and retrieved just-in-time by the AgentCore runtime.
 *
 * Usage:
 *   CDP_API_KEY_ID=... \
 *   CDP_API_KEY_SECRET=... \
 *   pnpm --filter @poc/buyer mcp
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname, "../../../.env") });
import { createAmpersendTreasurer } from "@ampersend_ai/ampersend-sdk";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@ampersend_ai/ampersend-sdk/mcp/client";
import { createAgentCoreWallet } from "./agentcore-wallet.js";

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

async function main() {
  const walletProvider = await createAgentCoreWallet();
  const address = walletProvider.getAddress();

  console.log(`[mcp-buyer] Connecting to seller at ${SELLER_URL}`);
  console.log(`[mcp-buyer] AgentCore wallet: ${address} (${walletProvider.getMode()} mode)`);

  // Create AmpersendTreasurer using the AgentCore wallet's underlying key.
  // In production, the smart account would be provisioned via the Ampersend
  // setup flow tied to the CDP wallet address.
  const smartAccountAddress =
    process.env.BUYER_SMART_ACCOUNT_ADDRESS ?? address;
  const sessionKeyPrivateKey =
    process.env.BUYER_SESSION_KEY_PRIVATE_KEY;

  let treasurer;
  if (smartAccountAddress && sessionKeyPrivateKey) {
    treasurer = createAmpersendTreasurer({
      smartAccountAddress: smartAccountAddress as `0x${string}`,
      sessionKeyPrivateKey: sessionKeyPrivateKey as `0x${string}`,
      apiUrl: process.env.AMPERSEND_API_URL ?? "https://api.ampersend.ai",
      chainId: process.env.CHAIN_NETWORK === "base" ? 8453 : 84532,
    });
    console.log("[mcp-buyer] Using AmpersendTreasurer (spend-limited)");
  } else {
    console.log(
      "[mcp-buyer] No smart account configured — falling back to NaiveTreasurer",
    );
    treasurer = walletProvider.createNaiveTreasurer();
  }

  const client = new Client(
    { name: "mcp-buyer", version: "2.0.0" },
    { mcpOptions: { capabilities: {} }, treasurer },
  );

  const transport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await client.connect(transport);
  console.log("[mcp-buyer] Connected\n");

  const { tools } = await client.listTools();
  console.log(
    "[mcp-buyer] Available tools:",
    tools.map((t) => t.name),
  );

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
