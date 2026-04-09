"use client";

import type { ToolResponse } from "../types";

interface Props {
  responses: ToolResponse[];
}

export function ResponsePanel({ responses }: Props) {
  if (responses.length === 0) {
    return (
      <section className="rounded-xl border border-card-border bg-card p-5 flex items-center justify-center min-h-[300px]">
        <p className="text-muted text-sm">
          Results will appear here after invoking a tool.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-h-[700px] overflow-y-auto">
      <h2 className="text-lg font-semibold sticky top-0 bg-card pb-2">
        Responses
      </h2>

      {responses.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border border-card-border p-4 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  r.error ? "bg-error" : "bg-success"
                }`}
              />
              <span className="text-sm font-medium">{r.tool}</span>
              <span className="text-xs text-muted px-1.5 py-0.5 bg-card-border/50 rounded">
                {r.buyerPattern}
              </span>
            </div>
            <span className="text-xs text-muted">{r.durationMs}ms</span>
          </div>

          {r.error ? (
            <pre className="text-xs text-error bg-error/10 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono">
              {r.error}
            </pre>
          ) : (
            <pre className="text-xs bg-background p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
              {r.result}
            </pre>
          )}

          <p className="text-xs text-muted">
            {new Date(r.timestamp).toLocaleTimeString()}
          </p>
        </div>
      ))}
    </section>
  );
}
