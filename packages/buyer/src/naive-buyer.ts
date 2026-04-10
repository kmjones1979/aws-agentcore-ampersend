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
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createAgentCoreWallet } from "./agentcore-wallet.js";

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

function logBuyerAddressAudit(walletAddress: string, mode: "cdp" | "local"): void {
  const net = process.env.CHAIN_NETWORK ?? "base-sepolia";
  const explorerBase =
    net === "base"
      ? "https://basescan.org/address/"
      : "https://sepolia.basescan.org/address/";
  const rawBuyer = process.env.BUYER_PRIVATE_KEY?.trim() as Hex | undefined;
  let derivedFromEnv: string | undefined;
  if (rawBuyer) {
    try {
      derivedFromEnv = privateKeyToAccount(rawBuyer).address;
    } catch {
      derivedFromEnv = undefined;
    }
  }
  console.log(
    "[naive-buyer] ========== x402 address audit (public only; never log private keys) ==========",
  );
  console.log(`[naive-buyer] CHAIN_NETWORK (tool leg): ${net}`);
  console.log(`[naive-buyer] AgentCore wallet address (x402 payer for tools): ${walletAddress}`);
  console.log(`[naive-buyer] Wallet mode: ${mode}`);
  if (derivedFromEnv) {
    const match =
      derivedFromEnv.toLowerCase() === walletAddress.toLowerCase()
        ? "(matches BUYER_PRIVATE_KEY)"
        : "(differs from BUYER_PRIVATE_KEY — likely CDP or different key)";
    console.log(`[naive-buyer] BUYER_PRIVATE_KEY → address: ${derivedFromEnv} ${match}`);
  } else {
    console.log("[naive-buyer] BUYER_PRIVATE_KEY: not set");
  }
  const cdpPin = process.env.CDP_WALLET_ADDRESS?.trim();
  if (cdpPin) {
    console.log(`[naive-buyer] CDP_WALLET_ADDRESS (env pin): ${cdpPin}`);
  }
  console.log(
    `[naive-buyer] Explorer — USDC out from payer (tool leg): ${explorerBase}${walletAddress}#tokentxns`,
  );
  console.log(
    "[naive-buyer] Tip: tool payee is SELLER_WALLET_ADDRESS on seller; compare seller startup audit.",
  );
  console.log("[naive-buyer] ================================================================");
}

async function main() {
  console.log(`[naive-buyer] Connecting to seller at ${SELLER_URL}`);

  const walletProvider = await createAgentCoreWallet();
  const addr = walletProvider.getAddress();
  const mode = walletProvider.getMode();
  console.log(`[naive-buyer] Wallet: ${addr} (${mode} mode)`);
  logBuyerAddressAudit(addr, mode);

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
