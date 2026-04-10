/**
 * Local Memory Store — mirrors AgentCore Memory concepts (short-term + long-term).
 *
 * Short-term: in-memory conversation turns within a session.
 * Long-term: persists tool results and spending history to a JSON file so the
 * agent can skip re-paying for duplicate research across sessions.
 *
 * Swap for `@aws-sdk/client-bedrock-agentcore` Memory APIs when deploying to AWS.
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
}

export interface CachedToolResult {
  toolName: string;
  argsHash: string;
  result: string;
  costMicroUsdc: number;
  timestamp: number;
  sessionId: string;
}

export interface SpendingRecord {
  toolName: string;
  costMicroUsdc: number;
  timestamp: number;
  sessionId: string;
  txHash?: string;
}

interface LongTermStore {
  cachedResults: CachedToolResult[];
  spendingHistory: SpendingRecord[];
}

// ---------------------------------------------------------------------------
// Memory client
// ---------------------------------------------------------------------------

const DEFAULT_STORE_PATH = resolve(
  import.meta.dirname ?? process.cwd(),
  "../../../.agentcore-memory.json",
);

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class MemoryClient {
  private sessionId: string;
  private shortTerm: MemoryTurn[] = [];
  private longTerm: LongTermStore;
  private storePath: string;

  constructor(sessionId?: string, storePath?: string) {
    this.sessionId = sessionId ?? crypto.randomUUID();
    this.storePath = storePath ?? DEFAULT_STORE_PATH;
    this.longTerm = this.loadStore();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // ---- Short-term (session) memory ----

  addTurn(role: MemoryTurn["role"], content: string): void {
    this.shortTerm.push({ role, content, timestamp: Date.now() });
  }

  getConversation(): readonly MemoryTurn[] {
    return this.shortTerm;
  }

  // ---- Long-term (cross-session) memory ----

  /**
   * Check if we already have a cached result for this tool+args.
   * Returns the cached result text if found and not expired, otherwise null.
   */
  lookupCache(toolName: string, args: Record<string, unknown>): string | null {
    const hash = this.hashArgs(toolName, args);
    const now = Date.now();
    const entry = this.longTerm.cachedResults.find(
      (c) => c.toolName === toolName && c.argsHash === hash && now - c.timestamp < CACHE_TTL_MS,
    );
    return entry?.result ?? null;
  }

  /** Store a tool result in the long-term cache. */
  cacheResult(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
    costMicroUsdc: number,
  ): void {
    const hash = this.hashArgs(toolName, args);
    // Remove stale entry for same tool+args if present
    this.longTerm.cachedResults = this.longTerm.cachedResults.filter(
      (c) => !(c.toolName === toolName && c.argsHash === hash),
    );
    this.longTerm.cachedResults.push({
      toolName,
      argsHash: hash,
      result,
      costMicroUsdc,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });
    this.persist();
  }

  /** Record spending for audit trail. */
  recordSpending(toolName: string, costMicroUsdc: number, txHash?: string): void {
    this.longTerm.spendingHistory.push({
      toolName,
      costMicroUsdc,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      txHash,
    });
    this.persist();
  }

  /** Total USDC spent across all sessions. */
  totalSpentAllTime(): number {
    return this.longTerm.spendingHistory.reduce((sum, r) => sum + r.costMicroUsdc, 0);
  }

  /** Total USDC saved by cache hits across all sessions. */
  totalSavedByCache(): number {
    // Count cached results that were reused (appeared in multiple sessions)
    const hashCounts = new Map<string, number>();
    for (const c of this.longTerm.cachedResults) {
      const key = `${c.toolName}:${c.argsHash}`;
      hashCounts.set(key, (hashCounts.get(key) ?? 0) + 1);
    }
    let saved = 0;
    for (const c of this.longTerm.cachedResults) {
      const key = `${c.toolName}:${c.argsHash}`;
      if ((hashCounts.get(key) ?? 0) > 1) saved += c.costMicroUsdc;
    }
    return saved;
  }

  getSpendingHistory(): readonly SpendingRecord[] {
    return this.longTerm.spendingHistory;
  }

  // ---- Internals ----

  private hashArgs(toolName: string, args: Record<string, unknown>): string {
    const normalized = JSON.stringify({ tool: toolName, ...args }, Object.keys(args).sort());
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  private loadStore(): LongTermStore {
    if (existsSync(this.storePath)) {
      try {
        return JSON.parse(readFileSync(this.storePath, "utf-8"));
      } catch {
        // Corrupt file — start fresh
      }
    }
    return { cachedResults: [], spendingHistory: [] };
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.longTerm, null, 2));
    } catch {
      // Best-effort persistence
    }
  }
}

export function createMemoryClient(sessionId?: string): MemoryClient {
  return new MemoryClient(sessionId);
}
