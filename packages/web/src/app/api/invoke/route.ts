import { NextResponse } from "next/server";
import type { InvokeRequest } from "../../types";

const SELLER_URL = process.env.SELLER_URL ?? "http://localhost:8000/mcp";
const PROXY_URL = process.env.PROXY_URL ?? "http://localhost:8402/mcp";

/**
 * POST /api/invoke
 *
 * Invokes a tool on the seller's FastMCP server using the selected buyer
 * pattern. In a real deployment the MCP client libraries would run
 * server-side here; for this POC we demonstrate the flow by forwarding
 * JSON-RPC over HTTP to the seller's streamable-HTTP MCP endpoint.
 */
export async function POST(req: Request) {
  try {
    const body: InvokeRequest = await req.json();
    const { tool, args, buyerPattern } = body;

    const target =
      buyerPattern === "proxy"
        ? `${PROXY_URL}?target=${encodeURIComponent(SELLER_URL)}`
        : SELLER_URL;

    // MCP JSON-RPC: initialize session
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
        { error: `Seller init failed: ${initRes.status} ${initRes.statusText}` },
        { status: 502 },
      );
    }

    const sessionId = initRes.headers.get("mcp-session-id");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    // MCP JSON-RPC: call tool
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

    // The seller returns 402 when payment is required (expected for non-proxy
    // patterns without a real wallet attached to this API route). We surface
    // the requirement info so the dashboard can display the payment flow.
    if (toolRes.status === 402) {
      const text = await toolRes.text();
      return NextResponse.json({
        error: `Payment required (402). In production, the buyer's Treasurer would authorize and sign a payment automatically.\n\nRaw requirements:\n${text}`,
      });
    }

    // Handle SSE response (streamable HTTP transport)
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
            // ignore parse errors on partial SSE chunks
          }
        }
      }
      return NextResponse.json({
        result: results.join("\n") || text,
      });
    }

    // Handle JSON response
    if (contentType.includes("application/json")) {
      const data = await toolRes.json();

      if (data.error) {
        const errData = data.error?.data ?? data.error;
        if (errData?.code === 402 || errData?.x402Version) {
          return NextResponse.json({
            error: `Payment required (x402). Requirements: ${JSON.stringify(errData.accepts ?? errData, null, 2)}`,
          });
        }
        return NextResponse.json({
          error: data.error.message ?? JSON.stringify(data.error),
        });
      }

      if (data.result?.content) {
        const text = data.result.content
          .map((c: { text?: string }) => c.text ?? "")
          .join("\n");
        return NextResponse.json({ result: text });
      }

      return NextResponse.json({ result: JSON.stringify(data, null, 2) });
    }

    const raw = await toolRes.text();
    return NextResponse.json({ result: raw });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
