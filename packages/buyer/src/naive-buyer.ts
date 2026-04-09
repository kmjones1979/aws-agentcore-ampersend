/**
 * Naive Buyer — MCP client using AgentCore wallet, auto-approves all payments.
 *
 * Demonstrates the AgentCore wallet pattern: wallet credentials are retrieved
 * from the environment (simulating AWS Secrets Manager), then used to create
 * an x402-capable treasurer that auto-approves every payment.
 *
 * Usage:
 *   # With CDP credentials (production):
 *   CDP_API_KEY_ID=... CDP_API_KEY_SECRET=... pnpm --filter @poc/buyer naive
 *
 *   # With raw key (testing):
 *   BUYER_PRIVATE_KEY=0x... pnpm --filter @poc/buyer naive
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname, "../../../.env") });
import {
  Client,
  StreamableHTTPClientTransport,
} from "@ampersend_ai/ampersend-sdk/mcp/client";
import { createAgentCoreWallet } from "./agentcore-wallet.js";

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

async function main() {
  console.log(`[naive-buyer] Connecting to seller at ${SELLER_URL}`);

  const walletProvider = await createAgentCoreWallet();
  console.log(`[naive-buyer] Wallet: ${walletProvider.getAddress()} (${walletProvider.getMode()} mode)`);

  const treasurer = walletProvider.createNaiveTreasurer();

  const client = new Client(
    { name: "naive-buyer", version: "2.0.0" },
    { mcpOptions: { capabilities: {} }, treasurer },
  );

  const transport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await client.connect(transport);
  console.log("[naive-buyer] Connected\n");

  const { tools } = await client.listTools();
  console.log(
    "[naive-buyer] Available tools:",
    tools.map((t) => t.name),
  );

  console.log("\n--- Calling research_topic ---");
  const researchResult = await client.callTool({
    name: "research_topic",
    arguments: { topic: "x402 payment protocol", depth: "brief" },
  });
  console.log("[naive-buyer] Result:", JSON.stringify(researchResult, null, 2));

  console.log("\n--- Calling summarize_text ---");
  const summarizeResult = await client.callTool({
    name: "summarize_text",
    arguments: {
      text: "The x402 protocol enables autonomous agent payments using stablecoins. It allows agents to pay for services without human approval for each transaction, within user-defined spending limits. The protocol is transport-agnostic and works with HTTP, MCP, and A2A transports.",
      max_sentences: 2,
    },
  });
  console.log(
    "[naive-buyer] Result:",
    JSON.stringify(summarizeResult, null, 2),
  );

  console.log("\n--- Calling generate_code ---");
  const codeResult = await client.callTool({
    name: "generate_code",
    arguments: {
      description: "A function that calculates the nth Fibonacci number",
      language: "typescript",
    },
  });
  console.log("[naive-buyer] Result:", JSON.stringify(codeResult, null, 2));

  await client.close();
  console.log("\n[naive-buyer] Done.");
}

main().catch(console.error);
