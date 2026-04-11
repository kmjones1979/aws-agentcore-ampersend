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
        <span>Architecture &mdash; AgentCore + x402 Payment Flow</span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <Card title="Policy" color="text-amber-400">
              <p className="text-xs text-muted">
                Cedar-inspired rule engine. Enforces session budgets, per-call caps,
                and tool allowlists before any payment is signed.
              </p>
              <Tags items={["Cedar semantics", "Default-deny", "Session ledger"]} />
            </Card>

            <Card title="Memory" color="text-emerald-400">
              <p className="text-xs text-muted">
                Cross-session cache. Skips re-paying for duplicate tool calls.
                Tracks spending history for cost awareness.
              </p>
              <Tags items={["Short-term", "Long-term", "Cache TTL 1h"]} />
            </Card>

            <Card title="Observability" color="text-sky-400">
              <p className="text-xs text-muted">
                OpenTelemetry spans trace the full lifecycle: policy check, memory
                lookup, payment signing, on-chain settlement, LLM call.
              </p>
              <Tags items={["OpenTelemetry", "ADOT-ready", "CloudWatch"]} />
            </Card>
          </div>

          <div className="p-4 rounded-lg bg-background font-mono text-xs leading-relaxed overflow-x-auto">
            <pre>{`  Client          Buyer                    Seller              Chain
    |               |                        |                   |
    |-- invoke ---->|                        |                   |
    |               |-- [Policy] check ----->|                   |
    |               |   allowed / denied     |                   |
    |               |                        |                   |
    |               |-- [Memory] lookup      |                   |
    |               |   cache hit? skip ---->|                   |
    |               |   cache miss:          |                   |
    |               |                        |                   |
    |               |-- callTool + x402 ---->|                   |
    |               |                        |-- verify -------->|
    |               |                        |-- settle (USDC) ->|
    |               |                        |                   |
    |               |                        |-- BlockRun LLM    |
    |               |<-- result + tx hash ---|                   |
    |               |                        |                   |
    |               |-- [Memory] cache result                    |
    |               |-- [Policy] record spend                    |
    |<-- display ---|                                            |`}</pre>
          </div>
        </div>
      )}
    </section>
  );
}

function Card({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-lg border border-card-border space-y-2">
      <h3 className={`font-semibold ${color}`}>{title}</h3>
      {children}
    </div>
  );
}

function Tags({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {items.map((t) => (
        <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">
          {t}
        </span>
      ))}
    </div>
  );
}
