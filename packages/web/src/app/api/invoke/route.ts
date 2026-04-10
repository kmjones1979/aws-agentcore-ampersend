import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { NextResponse } from "next/server";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@ampersend_ai/ampersend-sdk/mcp/client";
import { createAgentCoreWallet } from "@poc/buyer/agentcore-wallet";
import type { InvokeRequest } from "../../types";

/** Load monorepo root `.env` when Next runs from `packages/web` (same as CLI buyers). */
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
const PROXY_URL = process.env.PROXY_URL ?? "http://localhost:8402/mcp";

function resultToText(result: unknown): string {
  const r = result as { content?: Array<{ text?: string }> };
  if (r.content?.length) {
    return r.content.map((c) => c.text ?? "").join("\n");
  }
  return JSON.stringify(result);
}

/**
 * POST /api/invoke
 *
 * - **naive / ampersend:** Uses `createAgentCoreWallet()` + Ampersend MCP `Client`
 *   (same path as `pnpm buyer:naive`) so x402 is signed by the CDP or
 *   `BUYER_PRIVATE_KEY` wallet.
 * - **proxy:** Forwards to a running `pnpm buyer:proxy` (wallet lives in the proxy process).
 */
export async function POST(req: Request) {
  try {
    const body: InvokeRequest = await req.json();
    const { tool, args, buyerPattern } = body;

    const target =
      buyerPattern === "proxy"
        ? `${PROXY_URL}?target=${encodeURIComponent(SELLER_URL)}`
        : SELLER_URL;

    if (buyerPattern === "proxy") {
      return invokeViaRawMcpFetch(target, tool, args);
    }

    const walletProvider = await createAgentCoreWallet();
    const treasurer = walletProvider.createNaiveTreasurer();

    const client = new Client(
      { name: "poc-web", version: "1.0.0" },
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
      return NextResponse.json({ result: resultToText(result) });
    } finally {
      await client.close();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Legacy path: MCP proxy server performs x402 (run `pnpm buyer:proxy` separately). */
async function invokeViaRawMcpFetch(
  target: string,
  tool: string,
  args: Record<string, unknown>,
) {
  const initRes = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        clientInfo: { name: "poc-web", version: "1.0.0" },
      },
    }),
  });

  if (!initRes.ok) {
    return NextResponse.json(
      {
        error: `Seller/proxy init failed: ${initRes.status}. Is the proxy running (pnpm buyer:proxy)?`,
      },
      { status: 502 },
    );
  }

  const sessionId = initRes.headers.get("mcp-session-id");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const toolRes = await fetch(target, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });

  const contentType = toolRes.headers.get("content-type") ?? "";

  if (toolRes.status === 402) {
    const text = await toolRes.text();
    return NextResponse.json({
      error: `Payment required (402). Start the proxy with AgentCore wallet env: pnpm buyer:proxy\n\n${text}`,
    });
  }

  if (contentType.includes("text/event-stream")) {
    const text = await toolRes.text();
    const lines = text.split("\n");
    const results: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.result?.content) {
            for (const c of parsed.result.content) {
              if (c.text) results.push(c.text);
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return NextResponse.json({
      result: results.join("\n") || text,
    });
  }

  if (contentType.includes("application/json")) {
    const data = await toolRes.json();
    if (data.error) {
      return NextResponse.json({
        error: data.error.message ?? JSON.stringify(data.error),
      });
    }
    if (data.result?.content) {
      const t = data.result.content
        .map((c: { text?: string }) => c.text ?? "")
        .join("\n");
      return NextResponse.json({ result: t });
    }
    return NextResponse.json({ result: JSON.stringify(data, null, 2) });
  }

  const raw = await toolRes.text();
  return NextResponse.json({ result: raw });
}
