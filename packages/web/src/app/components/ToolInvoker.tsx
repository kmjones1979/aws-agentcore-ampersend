"use client";

import { useState } from "react";
import type { PaymentEvent, ToolResponse, InvokeRequest } from "../types";

const TOOLS = [
  {
    name: "research_topic",
    label: "Research Topic",
    cost: "0.01 USDC",
    fields: [
      { key: "topic", label: "Topic", type: "text", placeholder: "e.g. x402 payment protocol" },
      {
        key: "depth",
        label: "Depth",
        type: "select",
        options: ["brief", "detailed"],
      },
    ],
  },
  {
    name: "summarize_text",
    label: "Summarize Text",
    cost: "0.005 USDC",
    fields: [
      {
        key: "text",
        label: "Text",
        type: "textarea",
        placeholder: "Paste text to summarize...",
      },
      { key: "max_sentences", label: "Max Sentences", type: "number", placeholder: "3" },
    ],
  },
  {
    name: "generate_code",
    label: "Generate Code",
    cost: "0.02 USDC",
    fields: [
      {
        key: "description",
        label: "Description",
        type: "text",
        placeholder: "e.g. Fibonacci function",
      },
      {
        key: "language",
        label: "Language",
        type: "select",
        options: ["typescript", "python", "solidity", "rust"],
      },
    ],
  },
] as const;

const BUYER_PATTERNS = [
  { value: "naive" as const, label: "Naive (auto-approve)", desc: "NaiveTreasurer — no spend limits" },
  { value: "ampersend" as const, label: "Ampersend", desc: "AmpersendTreasurer — spend-limited" },
  { value: "proxy" as const, label: "Proxy", desc: "Via MCP proxy on :8402" },
];

interface Props {
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  onPaymentEvent: (e: PaymentEvent) => void;
  onResult: (r: ToolResponse) => void;
}

export function ToolInvoker({
  isLoading,
  setIsLoading,
  onPaymentEvent,
  onResult,
}: Props) {
  const [selectedTool, setSelectedTool] = useState(0);
  const [buyerPattern, setBuyerPattern] = useState<InvokeRequest["buyerPattern"]>("naive");
  const [args, setArgs] = useState<Record<string, string>>({});

  const tool = TOOLS[selectedTool];

  const handleInvoke = async () => {
    setIsLoading(true);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    onPaymentEvent({
      id,
      timestamp,
      tool: tool.name,
      buyerPattern,
      status: "pending",
      amount: tool.cost,
      message: "Initiating tool call...",
    });

    const start = Date.now();

    try {
      const parsedArgs: Record<string, unknown> = { ...args };
      if (parsedArgs.max_sentences) {
        parsedArgs.max_sentences = Number(parsedArgs.max_sentences);
      }

      const res = await fetch("/api/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: tool.name,
          args: parsedArgs,
          buyerPattern,
        } satisfies InvokeRequest),
      });

      const data = await res.json();
      const durationMs = Date.now() - start;

      if (data.error) {
        onPaymentEvent({
          id,
          timestamp: new Date().toISOString(),
          tool: tool.name,
          buyerPattern,
          status: "error",
          amount: tool.cost,
          message: data.error,
        });
        onResult({
          id,
          timestamp,
          tool: tool.name,
          buyerPattern,
          error: data.error,
          durationMs,
        });
      } else {
        onPaymentEvent({
          id,
          timestamp: new Date().toISOString(),
          tool: tool.name,
          buyerPattern,
          status: "settled",
          amount: tool.cost,
          message: "Payment settled successfully",
        });
        onResult({
          id,
          timestamp,
          tool: tool.name,
          buyerPattern,
          result: data.result,
          durationMs,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onPaymentEvent({
        id,
        timestamp: new Date().toISOString(),
        tool: tool.name,
        buyerPattern,
        status: "error",
        message: msg,
      });
      onResult({
        id,
        timestamp,
        tool: tool.name,
        buyerPattern,
        error: msg,
        durationMs: Date.now() - start,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5">
      <h2 className="text-lg font-semibold">Invoke Tool</h2>

      {/* Tool selector */}
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map((t, i) => (
          <button
            key={t.name}
            onClick={() => {
              setSelectedTool(i);
              setArgs({});
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              selectedTool === i
                ? "bg-accent text-white"
                : "bg-card-border/50 hover:bg-card-border"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">{t.cost}</span>
          </button>
        ))}
      </div>

      {/* Tool args */}
      <div className="space-y-3">
        {tool.fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-muted mb-1">
              {f.label}
            </label>
            {f.type === "select" ? (
              <select
                value={args[f.key] ?? (f.options as readonly string[])[0]}
                onChange={(e) => setArgs({ ...args, [f.key]: e.target.value })}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              >
                {(f.options as readonly string[]).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
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

      {/* Buyer pattern */}
      <div>
        <label className="block text-xs font-medium text-muted mb-2">
          Buyer Pattern
        </label>
        <div className="space-y-2">
          {BUYER_PATTERNS.map((bp) => (
            <label
              key={bp.value}
              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                buyerPattern === bp.value
                  ? "border-accent bg-accent/10"
                  : "border-card-border hover:border-accent/50"
              }`}
            >
              <input
                type="radio"
                name="buyerPattern"
                value={bp.value}
                checked={buyerPattern === bp.value}
                onChange={() => setBuyerPattern(bp.value)}
                className="accent-accent"
              />
              <div>
                <span className="text-sm font-medium">{bp.label}</span>
                <p className="text-xs text-muted">{bp.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Submit */}
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
