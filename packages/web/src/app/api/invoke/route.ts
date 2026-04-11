import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { NextResponse } from "next/server";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@ampersend_ai/ampersend-sdk/mcp/client";
import { createAgentCoreWallet } from "@poc/buyer/agentcore-wallet";
import { createDefaultPolicy } from "@poc/buyer/policy";
import { createMemoryClient } from "@poc/buyer/memory";
import type { InvokeRequest, InvokeResponse } from "../../types";

function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      loadEnv({ path: p });
      return;
    }
  }
}

loadRootEnv();

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

const TOOL_COSTS: Record<string, number> = {
  research_topic: 10000,
  summarize_text: 5000,
  generate_code: 20000,
};

// Persistent across requests within the same server process
const policy = createDefaultPolicy();
const memory = createMemoryClient(policy.getSessionId());

function resultToText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  if (r.content?.length) {
    return r.content.map((c) => c.text ?? "").join("\n");
  }
  return JSON.stringify(result);
}

export async function POST(req: Request) {
  try {
    const body: InvokeRequest = await req.json();
    const { tool, args } = body;
    const cost = TOOL_COSTS[tool] ?? 0;

    // 1) Policy check
    const decision = policy.evaluate(tool, cost);

    if (!decision.allowed) {
      const resp: InvokeResponse = {
        error: `Policy denied: ${decision.reason}`,
        source: "denied",
        policy: decision,
        memory: {
          cacheHit: false,
          allTimeSpent: memory.totalSpentAllTime(),
          priorRecords: memory.getSpendingHistory().length,
        },
        ledger: { ...policy.getLedger() },
      };
      return NextResponse.json(resp);
    }

    // 2) Memory lookup
    const cached = memory.lookupCache(tool, args as Record<string, unknown>);
    if (cached) {
      const resp: InvokeResponse = {
        result: cached,
        source: "cache",
        policy: decision,
        memory: {
          cacheHit: true,
          allTimeSpent: memory.totalSpentAllTime(),
          priorRecords: memory.getSpendingHistory().length,
        },
        ledger: { ...policy.getLedger() },
      };
      return NextResponse.json(resp);
    }

    // 3) Paid tool call
    const walletProvider = await createAgentCoreWallet();
    const treasurer = walletProvider.createNaiveTreasurer();

    const client = new Client(
      { name: "poc-web", version: "2.0.0" },
      { mcpOptions: { capabilities: {} }, treasurer },
    );

    await client.connect(
      new StreamableHTTPClientTransport(new URL(SELLER_URL)),
    );

    try {
      const result = await client.callTool({
        name: tool,
        arguments: args as Record<string, unknown>,
      });

      const text = resultToText(result);
      const meta = (result as any)?._meta?.["x402/payment-response"];

      // Record in policy + memory
      policy.recordCall(tool, cost);
      memory.cacheResult(tool, args as Record<string, unknown>, text, cost);
      memory.recordSpending(tool, cost, meta?.transaction);

      const resp: InvokeResponse = {
        result: text,
        source: "paid",
        policy: decision,
        memory: {
          cacheHit: false,
          allTimeSpent: memory.totalSpentAllTime(),
          priorRecords: memory.getSpendingHistory().length,
        },
        ledger: { ...policy.getLedger() },
        paymentMeta: meta ?? undefined,
      };
      return NextResponse.json(resp);
    } finally {
      await client.close();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const resp: InvokeResponse = {
      error: msg,
      source: "denied",
      policy: { allowed: false, reason: msg },
      memory: {
        cacheHit: false,
        allTimeSpent: memory.totalSpentAllTime(),
        priorRecords: memory.getSpendingHistory().length,
      },
      ledger: { ...policy.getLedger() },
    };
    return NextResponse.json(resp, { status: 500 });
  }
}
