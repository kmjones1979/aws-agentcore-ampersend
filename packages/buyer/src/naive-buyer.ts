/**
 * Naive Buyer — MCP client with AgentCore Policy, Memory, and Observability.
 *
 * Demonstrates:
 * - **Policy**: Cedar-inspired local rules enforce spending limits and tool governance
 * - **Memory**: Cross-session cache skips re-paying for duplicate research
 * - **Observability**: OpenTelemetry spans trace the full payment lifecycle
 *
 * Usage:
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
import { createDefaultPolicy, type PolicyEngine } from "./policy.js";
import { createMemoryClient, type MemoryClient } from "./memory.js";
import { initTelemetry, withSpan, shutdownTelemetry, type Tracer } from "./telemetry.js";

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

// Tool cost map (micro-USDC) — must match seller pricing
const TOOL_COSTS: Record<string, number> = {
  research_topic: 10000,
  summarize_text: 5000,
  generate_code: 20000,
};

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
    "[naive-buyer] ========== x402 address audit ==========",
  );
  console.log(`[naive-buyer] CHAIN_NETWORK: ${net}`);
  console.log(`[naive-buyer] Wallet: ${walletAddress} (${mode})`);
  if (derivedFromEnv) {
    const match =
      derivedFromEnv.toLowerCase() === walletAddress.toLowerCase()
        ? "(matches BUYER_PRIVATE_KEY)"
        : "(differs — likely CDP)";
    console.log(`[naive-buyer] BUYER_PRIVATE_KEY -> ${derivedFromEnv} ${match}`);
  }
  console.log(
    `[naive-buyer] Explorer: ${explorerBase}${walletAddress}#tokentxns`,
  );
  console.log("[naive-buyer] ====================================");
}

// ---------------------------------------------------------------------------
// Tool call with Policy + Memory + Telemetry
// ---------------------------------------------------------------------------

interface ToolCallResult {
  result: unknown;
  source: "cache" | "paid";
  policyDecision: string;
}

async function callToolWithGovernance(
  client: InstanceType<typeof Client>,
  tracer: Tracer,
  policy: PolicyEngine,
  memory: MemoryClient,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const cost = TOOL_COSTS[toolName] ?? 0;

  return withSpan(tracer, `tool_call:${toolName}`, {
    "tool.name": toolName,
    "tool.cost_micro_usdc": cost,
    "session.id": policy.getSessionId(),
  }, async (parentSpan) => {

    // 1) Policy check
    const decision = await withSpan(tracer, "policy_check", {
      "policy.tool": toolName,
      "policy.amount": cost,
      "policy.session_spent": policy.getLedger().totalSpent,
    }, async (span) => {
      const d = policy.evaluate(toolName, cost);
      span.setAttribute("policy.allowed", d.allowed);
      span.setAttribute("policy.rule", d.rule ?? "none");
      if (d.reason) span.setAttribute("policy.reason", d.reason);
      return d;
    });

    if (!decision.allowed) {
      console.log(`[policy] DENIED ${toolName}: ${decision.reason}`);
      parentSpan.setAttribute("tool.outcome", "policy_denied");
      return {
        result: { error: `Policy denied: ${decision.reason}` },
        source: "cache" as const,
        policyDecision: `DENIED: ${decision.reason}`,
      };
    }
    console.log(`[policy] ALLOWED ${toolName} (rule: ${decision.rule})`);

    // 2) Memory lookup
    const cached = await withSpan(tracer, "memory_lookup", {
      "memory.tool": toolName,
    }, async (span) => {
      const hit = memory.lookupCache(toolName, args);
      span.setAttribute("memory.cache_hit", hit !== null);
      if (hit) {
        console.log(`[memory] Cache HIT for ${toolName} — skipping paid call (saved ${cost / 1e6} USDC)`);
      } else {
        console.log(`[memory] Cache MISS for ${toolName} — will pay`);
      }
      return hit;
    });

    if (cached) {
      memory.addTurn("tool", `[cached] ${toolName}: ${cached.slice(0, 100)}...`);
      parentSpan.setAttribute("tool.outcome", "cache_hit");
      return {
        result: { content: [{ type: "text", text: cached }], _source: "memory_cache" },
        source: "cache" as const,
        policyDecision: `ALLOWED (rule: ${decision.rule})`,
      };
    }

    // 3) Paid tool call
    const toolResult = await withSpan(tracer, "mcp_tool_call", {
      "mcp.tool": toolName,
      "mcp.seller_url": SELLER_URL,
    }, async (span) => {
      const result = await client.callTool({ name: toolName, arguments: args });
      const meta = (result as any)?._meta?.["x402/payment-response"];
      if (meta?.transaction) {
        span.setAttribute("payment.tx_hash", meta.transaction);
        span.setAttribute("payment.network", meta.network ?? "unknown");
      }
      return result;
    });

    // 4) Record in policy ledger + memory
    policy.recordCall(toolName, cost);

    const resultText = (toolResult as any)?.content
      ?.map((c: any) => c.text ?? "")
      .join("\n") ?? JSON.stringify(toolResult);
    memory.cacheResult(toolName, args, resultText, cost);

    const txHash = (toolResult as any)?._meta?.["x402/payment-response"]?.transaction;
    memory.recordSpending(toolName, cost, txHash);
    memory.addTurn("tool", `${toolName}: ${resultText.slice(0, 100)}...`);

    parentSpan.setAttribute("tool.outcome", "paid");
    return {
      result: toolResult,
      source: "paid" as const,
      policyDecision: `ALLOWED (rule: ${decision.rule})`,
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Initialize telemetry first
  const tracer = initTelemetry("agentcore-buyer");

  await withSpan(tracer, "buyer_session", {
    "session.type": "naive-buyer",
    "seller.url": SELLER_URL,
  }, async (sessionSpan) => {

    console.log(`[naive-buyer] Connecting to seller at ${SELLER_URL}`);

    const walletProvider = await createAgentCoreWallet();
    const addr = walletProvider.getAddress();
    const mode = walletProvider.getMode();
    logBuyerAddressAudit(addr, mode);
    sessionSpan.setAttribute("wallet.address", addr);
    sessionSpan.setAttribute("wallet.mode", mode);

    // Initialize AgentCore services
    const policy = createDefaultPolicy();
    const memory = createMemoryClient(policy.getSessionId());
    memory.addTurn("user", "Starting naive buyer demo session");

    console.log(`\n[agentcore] Session: ${policy.getSessionId()}`);
    console.log("[agentcore] Policy: session-budget (max 0.05 USDC, max 2 calls/tool)");
    console.log(`[agentcore] Memory: long-term store with ${memory.getSpendingHistory().length} prior records`);
    console.log(`[agentcore] Telemetry: OpenTelemetry tracing active\n`);

    sessionSpan.setAttribute("policy.session_id", policy.getSessionId());

    const treasurer = walletProvider.createNaiveTreasurer();
    const client = new Client(
      { name: "naive-buyer", version: "3.0.0" },
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

    // ---- Tool calls with governance ----

    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [
      {
        name: "research_topic",
        args: { topic: "x402 payment protocol", depth: "brief" },
      },
      {
        name: "summarize_text",
        args: {
          text: "The x402 protocol enables autonomous agent payments using stablecoins. It allows agents to pay for services without human approval for each transaction, within user-defined spending limits. The protocol is transport-agnostic and works with HTTP, MCP, and A2A transports.",
          max_sentences: 2,
        },
      },
      {
        name: "generate_code",
        args: {
          description: "A function that calculates the nth Fibonacci number",
          language: "typescript",
        },
      },
    ];

    for (const tc of toolCalls) {
      console.log(`\n--- ${tc.name} ---`);
      const { result, source, policyDecision } = await callToolWithGovernance(
        client, tracer, policy, memory, tc.name, tc.args,
      );
      console.log(`[naive-buyer] Policy: ${policyDecision}`);
      console.log(`[naive-buyer] Source: ${source}`);
      console.log("[naive-buyer] Result:", JSON.stringify(result, null, 2));
    }

    // ---- Session summary ----

    const ledger = policy.getLedger();
    const totalPaidUsdc = ledger.totalSpent / 1e6;
    const historyTotal = memory.totalSpentAllTime() / 1e6;

    console.log("\n========== Session Summary ==========");
    console.log(`[policy]  Session spend: ${totalPaidUsdc} USDC (limit: 0.05 USDC)`);
    console.log(`[policy]  Tool calls:`, JSON.stringify(ledger.callCounts));
    console.log(`[memory]  All-time spend: ${historyTotal} USDC`);
    console.log(`[memory]  Cached results available for next run`);
    console.log("======================================\n");

    sessionSpan.setAttribute("session.total_spent_micro_usdc", ledger.totalSpent);
    sessionSpan.setAttribute("session.tools_called", Object.keys(ledger.callCounts).length);

    await client.close();
    console.log("[naive-buyer] Done.");
  });

  await shutdownTelemetry();
}

main().catch(console.error);
