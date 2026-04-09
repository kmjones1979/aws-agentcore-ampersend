export interface PaymentEvent {
  id: string;
  timestamp: string;
  tool: string;
  buyerPattern: string;
  status: "pending" | "authorized" | "paid" | "settled" | "error";
  amount?: string;
  message?: string;
}

export interface ToolResponse {
  id: string;
  timestamp: string;
  tool: string;
  buyerPattern: string;
  result?: string;
  error?: string;
  durationMs: number;
}

export interface InvokeRequest {
  tool: string;
  args: Record<string, unknown>;
  buyerPattern: "naive" | "ampersend" | "proxy";
}
