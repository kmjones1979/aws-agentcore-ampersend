export interface PolicyDecision {
  allowed: boolean;
  rule?: string;
  reason?: string;
}

export interface SessionLedger {
  totalSpent: number;
  callCounts: Record<string, number>;
}

export interface MemoryInfo {
  cacheHit: boolean;
  allTimeSpent: number;
  priorRecords: number;
}

export interface PaymentMeta {
  success?: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
}

export interface PaymentEvent {
  id: string;
  timestamp: string;
  tool: string;
  status: "pending" | "policy_check" | "memory_check" | "paying" | "settled" | "cached" | "denied" | "error";
  amount?: string;
  message?: string;
  policyDecision?: PolicyDecision;
  memoryHit?: boolean;
  txHash?: string;
}

export interface ToolResponse {
  id: string;
  timestamp: string;
  tool: string;
  result?: string;
  error?: string;
  durationMs: number;
  source: "paid" | "cache" | "denied";
  policyDecision?: PolicyDecision;
  memoryHit?: boolean;
  paymentMeta?: PaymentMeta;
}

export interface InvokeRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface InvokeResponse {
  result?: string;
  error?: string;
  source: "paid" | "cache" | "denied";
  policy: PolicyDecision;
  memory: MemoryInfo;
  ledger: SessionLedger;
  paymentMeta?: PaymentMeta;
}
