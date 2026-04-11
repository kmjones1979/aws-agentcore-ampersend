"use client";

import { useState } from "react";
import type { PaymentEvent, ToolResponse, InvokeRequest, InvokeResponse, SessionLedger, MemoryInfo } from "../types";

const TOOLS = [
  {
    name: "research_topic",
    label: "Research Topic",
    cost: "0.01 USDC",
    fields: [
      { key: "topic", label: "Topic", type: "text", placeholder: "e.g. x402 payment protocol" },
      { key: "depth", label: "Depth", type: "select", options: ["brief", "detailed"] },
    ],
  },
  {
    name: "summarize_text",
    label: "Summarize Text",
    cost: "0.005 USDC",
    fields: [
      { key: "text", label: "Text", type: "textarea", placeholder: "Paste text to summarize..." },
      { key: "max_sentences", label: "Max Sentences", type: "number", placeholder: "3" },
    ],
  },
  {
    name: "generate_code",
    label: "Generate Code",
    cost: "0.02 USDC",
    fields: [
      { key: "description", label: "Description", type: "text", placeholder: "e.g. Fibonacci function" },
      { key: "language", label: "Language", type: "select", options: ["typescript", "python", "solidity", "rust"] },
    ],
  },
] as const;

interface Props {
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  onPaymentEvent: (e: PaymentEvent) => void;
  onResult: (r: ToolResponse) => void;
  onGovernanceUpdate: (ledger: SessionLedger, memory: MemoryInfo, cacheHit: boolean) => void;
}

export function ToolInvoker({ isLoading, setIsLoading, onPaymentEvent, onResult, onGovernanceUpdate }: Props) {
  const [selectedTool, setSelectedTool] = useState(0);
  const [args, setArgs] = useState<Record<string, string>>({});
  const tool = TOOLS[selectedTool];

  const handleInvoke = async () => {
    setIsLoading(true);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    onPaymentEvent({
      id, timestamp, tool: tool.name,
      status: "policy_check", amount: tool.cost,
      message: "Checking policy...",
    });

    const start = Date.now();

    try {
      const parsedArgs: Record<string, unknown> = { ...args };
      if (parsedArgs.max_sentences) parsedArgs.max_sentences = Number(parsedArgs.max_sentences);

      const res = await fetch("/api/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.name, args: parsedArgs } satisfies InvokeRequest),
      });

      const data: InvokeResponse = await res.json();
      const durationMs = Date.now() - start;

      onGovernanceUpdate(data.ledger, data.memory, data.memory.cacheHit);

      if (data.source === "denied") {
        onPaymentEvent({
          id, timestamp: new Date().toISOString(), tool: tool.name,
          status: "denied", amount: tool.cost,
          message: data.error ?? data.policy.reason ?? "Policy denied",
          policyDecision: data.policy,
        });
        onResult({
          id, timestamp, tool: tool.name,
          error: data.error ?? `Policy denied: ${data.policy.reason}`,
          durationMs, source: "denied",
          policyDecision: data.policy,
        });
      } else if (data.source === "cache") {
        onPaymentEvent({
          id, timestamp: new Date().toISOString(), tool: tool.name,
          status: "cached", amount: tool.cost,
          message: "Cache hit — no payment needed",
          memoryHit: true,
          policyDecision: data.policy,
        });
        onResult({
          id, timestamp, tool: tool.name,
          result: data.result, durationMs, source: "cache",
          policyDecision: data.policy, memoryHit: true,
        });
      } else {
        onPaymentEvent({
          id, timestamp: new Date().toISOString(), tool: tool.name,
          status: "settled", amount: tool.cost,
          message: data.paymentMeta?.transaction
            ? `Settled on-chain: ${data.paymentMeta.transaction.slice(0, 10)}...`
            : "Payment settled",
          policyDecision: data.policy,
          txHash: data.paymentMeta?.transaction,
        });
        onResult({
          id, timestamp, tool: tool.name,
          result: data.result, durationMs, source: "paid",
          policyDecision: data.policy,
          paymentMeta: data.paymentMeta,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onPaymentEvent({
        id, timestamp: new Date().toISOString(), tool: tool.name,
        status: "error", message: msg,
      });
      onResult({
        id, timestamp, tool: tool.name,
        error: msg, durationMs: Date.now() - start, source: "denied",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5">
      <h2 className="text-lg font-semibold">Invoke Tool</h2>

      <div className="flex gap-2 flex-wrap">
        {TOOLS.map((t, i) => (
          <button
            key={t.name}
            onClick={() => { setSelectedTool(i); setArgs({}); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              selectedTool === i ? "bg-accent text-white" : "bg-card-border/50 hover:bg-card-border"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">{t.cost}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tool.fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-muted mb-1">{f.label}</label>
            {f.type === "select" ? (
              <select
                value={args[f.key] ?? (f.options as readonly string[])[0]}
                onChange={(e) => setArgs({ ...args, [f.key]: e.target.value })}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              >
                {(f.options as readonly string[]).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                rows={3}
                value={args[f.key] ?? ""}
                onChange={(e) => setArgs({ ...args, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm resize-none"
              />
            ) : (
              <input
                type={f.type}
                value={args[f.key] ?? ""}
                onChange={(e) => setArgs({ ...args, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleInvoke}
        disabled={isLoading}
        className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-light text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Processing..." : `Call ${tool.label}`}
      </button>
    </section>
  );
}
