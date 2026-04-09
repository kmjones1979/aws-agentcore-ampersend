/**
 * Naive Buyer — MCP client that auto-approves all payments.
 *
 * Demonstrates the simplest buyer pattern using an EOA wallet
 * with a treasurer that automatically pays every 402 request.
 * Use for local testing only — no spend limits.
 *
 * Usage:
 *   BUYER_PRIVATE_KEY=0x... pnpm --filter @poc/buyer naive
 */
import "dotenv/config";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@ampersend_ai/ampersend-sdk/mcp/client";
import {
  AccountWallet,
  type X402Treasurer,
  type Authorization,
  type PaymentContext,
  type PaymentStatus,
} from "@ampersend_ai/ampersend-sdk/x402";

// ---------------------------------------------------------------------------
// NaiveTreasurer — auto-approves every payment request
// ---------------------------------------------------------------------------

class NaiveTreasurer implements X402Treasurer {
  constructor(private wallet: InstanceType<typeof AccountWallet>) {}

  async onPaymentRequired(
    requirements: ReadonlyArray<any>,
    _context?: PaymentContext,
  ): Promise<Authorization | null> {
    if (requirements.length === 0) return null;
    const payment = await this.wallet.createPayment(requirements[0]);
    return { payment, authorizationId: crypto.randomUUID() };
  }

  async onStatus(
    status: PaymentStatus,
    authorization: Authorization,
    _context?: PaymentContext,
  ): Promise<void> {
    console.log(
      `[naive-buyer] Payment ${authorization.authorizationId}: ${status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

async function main() {
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set BUYER_PRIVATE_KEY in .env");
    process.exit(1);
  }

  console.log(`[naive-buyer] Connecting to seller at ${SELLER_URL}`);

  const wallet = AccountWallet.fromPrivateKey(privateKey as `0x${string}`);
  const treasurer = new NaiveTreasurer(wallet);

  const client = new Client(
    { name: "naive-buyer", version: "1.0.0" },
    { mcpOptions: { capabilities: {} }, treasurer },
  );

  const transport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await client.connect(transport);
  console.log("[naive-buyer] Connected\n");

  // List tools
  const { tools } = await client.listTools();
  console.log(
    "[naive-buyer] Available tools:",
    tools.map((t) => t.name),
  );

  // Call research_topic
  console.log("\n--- Calling research_topic ---");
  const researchResult = await client.callTool({
    name: "research_topic",
    arguments: { topic: "x402 payment protocol", depth: "brief" },
  });
  console.log("[naive-buyer] Result:", JSON.stringify(researchResult, null, 2));

  // Call summarize_text
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

  // Call generate_code
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
