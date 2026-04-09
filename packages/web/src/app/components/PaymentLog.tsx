"use client";

import type { PaymentEvent } from "../types";

interface Props {
  events: PaymentEvent[];
}

const STATUS_COLORS: Record<PaymentEvent["status"], string> = {
  pending: "bg-warning/20 text-warning",
  authorized: "bg-accent/20 text-accent",
  paid: "bg-accent-light/20 text-accent-light",
  settled: "bg-success/20 text-success",
  error: "bg-error/20 text-error",
};

export function PaymentLog({ events }: Props) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payment Flow Log</h2>
        <span className="text-xs text-muted">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">
          Payment events will stream here as tools are invoked.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {events.map((evt) => (
            <div
              key={`${evt.id}-${evt.status}`}
              className="flex items-center gap-3 text-sm p-2.5 rounded-lg bg-background"
            >
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  STATUS_COLORS[evt.status]
                }`}
              >
                {evt.status}
              </span>

              <span className="font-medium">{evt.tool}</span>
              <span className="text-xs text-muted px-1.5 py-0.5 bg-card-border/50 rounded">
                {evt.buyerPattern}
              </span>

              {evt.amount && (
                <span className="text-xs text-accent font-mono">
                  {evt.amount}
                </span>
              )}

              {evt.message && (
                <span className="text-xs text-muted truncate flex-1">
                  {evt.message}
                </span>
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
