"use client";

import { useState } from "react";

export function ArchitectureDiagram() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium hover:bg-card-border/30 transition-colors"
      >
        <span>Architecture Overview</span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {/* Seller */}
            <div className="p-4 rounded-lg border border-card-border space-y-2">
              <h3 className="font-semibold text-accent">Seller Agent</h3>
              <p className="text-xs text-muted">
                FastMCP server with x402 payment middleware. Each tool
                requires USDC payment before execution.
              </p>
              <div className="flex flex-wrap gap-1">
                <Tag>FastMCP</Tag>
                <Tag>withX402Payment</Tag>
                <Tag>Bedrock Claude</Tag>
              </div>
            </div>

            {/* Buyer Patterns */}
            <div className="p-4 rounded-lg border border-card-border space-y-2">
              <h3 className="font-semibold text-accent">Buyer Patterns</h3>
              <ul className="text-xs text-muted space-y-1">
                <li>
                  <strong>Naive:</strong> NaiveTreasurer (auto-approve)
                </li>
                <li>
                  <strong>Ampersend:</strong> AmpersendTreasurer
                  (spend-limited)
                </li>
                <li>
                  <strong>Proxy:</strong> MCP proxy on :8402
                </li>
                <li>
                  <strong>HTTP:</strong> x402 fetch wrapper
                </li>
              </ul>
            </div>

            {/* AgentCore */}
            <div className="p-4 rounded-lg border border-card-border space-y-2">
              <h3 className="font-semibold text-accent">AgentCore</h3>
              <p className="text-xs text-muted">
                TypeScript agent deployed via AgentCore CLI. Acts as an
                autonomous buyer calling paid tools within spend limits.
              </p>
              <div className="flex flex-wrap gap-1">
                <Tag>BedrockAgentCoreApp</Tag>
                <Tag>Container</Tag>
              </div>
            </div>
          </div>

          {/* Flow diagram */}
          <div className="p-4 rounded-lg bg-background font-mono text-xs leading-relaxed overflow-x-auto">
            <pre>{`  Client          Buyer             Seller            Bedrock
    |               |                 |                  |
    |-- invoke ---->|                 |                  |
    |               |-- callTool ---->|                  |
    |               |<-- 402 + reqs --|                  |
    |               |                 |                  |
    |               |  [Treasurer]    |                  |
    |               |  authorize &    |                  |
    |               |  sign payment   |                  |
    |               |                 |                  |
    |               |-- retry + pay ->|                  |
    |               |                 |-- AI query ----->|
    |               |                 |<-- response -----|
    |               |<-- result ------|                  |
    |<-- display ---|                 |                  |`}</pre>
          </div>
        </div>
      )}
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">
      {children}
    </span>
  );
}
