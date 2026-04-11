"use client";

import type { PaymentEvent } from "../types";

interface Props {
  events: PaymentEvent[];
}

const STATUS_STYLES: Record<PaymentEvent["status"], string> = {
  pending: "bg-warning/20 text-warning",
  policy_check: "bg-amber-400/20 text-amber-400",
  memory_check: "bg-emerald-400/20 text-emerald-400",
  paying: "bg-accent/20 text-accent",
  settled: "bg-success/20 text-success",
  cached: "bg-emerald-400/20 text-emerald-400",
  denied: "bg-error/20 text-error",
  error: "bg-error/20 text-error",
};

export function PaymentLog({ events }: Props) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Event Log</h2>
        <span className="text-xs text-muted">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">
          Events will stream here as tools are invoked.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {events.map((evt) => (
            <div
              key={`${evt.id}-${evt.status}`}
              className="flex items-center gap-3 text-sm p-2.5 rounded-lg bg-background"
            >
              <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATUS_STYLES[evt.status]}`}>
                {evt.status.replace("_", " ")}
              </span>
              <span className="font-medium">{evt.tool}</span>

              {evt.amount && (
                <span className="text-xs text-accent font-mono">{evt.amount}</span>
              )}

              {evt.message && (
                <span className="text-xs text-muted truncate flex-1">{evt.message}</span>
              )}

              {evt.txHash && (
                <a
                  href={`https://basescan.org/tx/${evt.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-sky-400 hover:underline whitespace-nowrap"
                >
                  {evt.txHash.slice(0, 10)}...
                </a>
              )}

              <span className="text-xs text-muted ml-auto whitespace-nowrap">
                {new Date(evt.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
