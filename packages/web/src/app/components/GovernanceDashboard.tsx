"use client";

import type { SessionLedger, MemoryInfo } from "../types";

interface Props {
  sessionId: string;
  ledger: SessionLedger;
  memory: MemoryInfo;
  cacheHits: number;
  cacheMisses: number;
}

export function GovernanceDashboard({ sessionId, ledger, memory, cacheHits, cacheMisses }: Props) {
  const spentUsdc = ledger.totalSpent / 1e6;
  const budgetUsdc = 0.05;
  const pct = Math.min((spentUsdc / budgetUsdc) * 100, 100);
  const allTimeUsdc = memory.allTimeSpent / 1e6;
  const totalCalls = Object.values(ledger.callCounts).reduce((a, b) => a + b, 0);

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">AgentCore Governance</h2>
        <span className="text-xs text-muted font-mono">
          session: {sessionId.slice(0, 8)}...
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Policy */}
        <div className="p-4 rounded-lg border border-card-border space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <h3 className="text-sm font-semibold text-amber-400">Policy</h3>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted">Session budget</span>
              <span className="font-mono">{spentUsdc.toFixed(4)} / {budgetUsdc} USDC</span>
            </div>
            <div className="w-full h-2 rounded-full bg-card-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  pct > 80 ? "bg-error" : pct > 50 ? "bg-warning" : "bg-amber-400"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-muted">Tool calls</span>
            <span className="font-mono">{totalCalls} / 6 max</span>
          </div>

          {Object.entries(ledger.callCounts).length > 0 && (
            <div className="space-y-1">
              {Object.entries(ledger.callCounts).map(([tool, count]) => (
                <div key={tool} className="flex justify-between text-xs">
                  <span className="text-muted truncate">{tool}</span>
                  <span className="font-mono">{count} / 2</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Memory */}
        <div className="p-4 rounded-lg border border-card-border space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h3 className="text-sm font-semibold text-emerald-400">Memory</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Cache hits" value={String(cacheHits)} color="text-emerald-400" />
            <Stat label="Cache misses" value={String(cacheMisses)} color="text-muted" />
            <Stat label="All-time spend" value={`${allTimeUsdc.toFixed(4)} USDC`} color="text-foreground" />
            <Stat label="Stored records" value={String(memory.priorRecords)} color="text-foreground" />
          </div>
        </div>

        {/* Observability */}
        <div className="p-4 rounded-lg border border-card-border space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            <h3 className="text-sm font-semibold text-sky-400">Observability</h3>
          </div>

          <div className="space-y-2 text-xs text-muted">
            <p>OpenTelemetry spans are emitted for every tool call:</p>
            <div className="space-y-1 font-mono">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>policy_check</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>memory_lookup</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span>mcp_tool_call</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                <span>settle + llm</span>
                <span className="text-muted">(seller)</span>
              </div>
            </div>
            <p className="pt-1">
              Set <code className="text-accent">OTEL_EXPORTER_OTLP_ENDPOINT</code> to
              send to ADOT / CloudWatch.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-sm font-mono font-medium ${color}`}>{value}</p>
    </div>
  );
}
