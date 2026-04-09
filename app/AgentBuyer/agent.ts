import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";

/** Walk up from this file (src/ or dist/) to find repo-root `.env` for local runs. */
function loadRepoDotenv(): void {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadEnv({ path: candidate });
      return;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
}
loadRepoDotenv();
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
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { keccak256, toBytes, type Hex, type LocalAccount } from "viem";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

// ---------------------------------------------------------------------------
// AgentCore wallet provider (embedded — same pattern as packages/buyer)
// ---------------------------------------------------------------------------

function resolveWallet(): { account: LocalAccount; mode: string } {
  const cdpKeyId = process.env.CDP_API_KEY_ID;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET;
  const rawKey = process.env.BUYER_PRIVATE_KEY as Hex | undefined;

  if (cdpKeyId && cdpKeySecret) {
    const seed = keccak256(toBytes(`${cdpKeyId}:${cdpKeySecret}`));
    return { account: privateKeyToAccount(seed), mode: "cdp" };
  }

  if (rawKey) {
    return { account: privateKeyToAccount(rawKey), mode: "local" };
  }

  return { account: privateKeyToAccount(generatePrivateKey()), mode: "ephemeral" };
}

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
  ): Promise<void> {
    console.log(
      `[agent-buyer] Payment ${authorization.authorizationId}: ${status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// MCP client helper
// ---------------------------------------------------------------------------

async function callSellerTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { account, mode } = resolveWallet();
  console.log(`[agent-buyer] Using ${mode} wallet: ${account.address}`);

  const wallet = new AccountWallet(account);
  const treasurer = new NaiveTreasurer(wallet);

  const client = new Client(
    { name: "agentcore-buyer", version: "2.0.0" },
    { mcpOptions: { capabilities: {} }, treasurer },
  );

  const transport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = (result as any).content
      ?.map((c: { text?: string }) => c.text ?? "")
      .join("\n");
    return text ?? JSON.stringify(result);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Intent routing
// ---------------------------------------------------------------------------

function parseIntent(prompt: string): {
  tool: string;
  args: Record<string, unknown>;
} {
  const lower = prompt.toLowerCase();

  if (lower.includes("summarize") || lower.includes("summary")) {
    return {
      tool: "summarize_text",
      args: { text: prompt, max_sentences: 3 },
    };
  }

  if (
    lower.includes("code") ||
    lower.includes("function") ||
    lower.includes("implement")
  ) {
    const lang = lower.includes("python")
      ? "python"
      : lower.includes("solidity")
        ? "solidity"
        : lower.includes("rust")
          ? "rust"
          : "typescript";
    return {
      tool: "generate_code",
      args: { description: prompt, language: lang },
    };
  }

  return {
    tool: "research_topic",
    args: { topic: prompt, depth: "brief" },
  };
}

// ---------------------------------------------------------------------------
// AgentCore entrypoint
// ---------------------------------------------------------------------------

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    process: async (payload, context) => {
      const prompt = (payload as { prompt?: string }).prompt ?? "Hello!";
      console.log(`[agent-buyer] Session ${context.sessionId} — prompt: ${prompt}`);

      const { tool, args } = parseIntent(prompt);
      console.log(`[agent-buyer] Routing to seller tool: ${tool}`);

      const result = await callSellerTool(tool, args);
      return {
        response: result,
        tool_used: tool,
        session_id: context.sessionId,
      };
    },
  },
});

app.run();

console.log(
  "[agent-buyer] AgentCore app started — invokes paid MCP tools on SELLER_URL (seller may use ClawRouter internally)",
);
