import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@ampersend_ai/ampersend-sdk/mcp/client";
import { createAgentCoreWallet } from "@poc/buyer/agentcore-wallet";

/** Walk up from this file to find repo-root `.env` for local runs. */
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

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";

async function callSellerTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const walletProvider = await createAgentCoreWallet();
  console.log(
    `[agent-buyer] Wallet ${walletProvider.getAddress()} (${walletProvider.getMode()} mode)`,
  );

  const treasurer = walletProvider.createNaiveTreasurer();

  const client = new Client(
    { name: "agentcore-buyer", version: "2.1.0" },
    { mcpOptions: { capabilities: {} }, treasurer },
  );

  const transport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = (result as { content?: Array<{ text?: string }> }).content
      ?.map((c) => c.text ?? "")
      .join("\n");
    return text ?? JSON.stringify(result);
  } finally {
    await client.close();
  }
}

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
  "[agent-buyer] AgentCore app started — paid MCP tools via AgentCore wallet (CDP or BUYER_PRIVATE_KEY)",
);
