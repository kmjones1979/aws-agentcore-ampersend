/**
 * Local Policy Engine — Cedar-inspired rule evaluation for agent tool calls.
 *
 * Mirrors the concepts from AgentCore Policy (Cedar rules, deny-by-default,
 * forbid-wins semantics) but runs locally without requiring AWS Gateway.
 * Swap for `@aws-sdk/client-bedrock-agentcore` policy APIs when deploying
 * to AgentCore with a real Gateway + PolicyEngine.
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html
 */

export type PolicyEffect = "permit" | "forbid";

export interface PolicyRule {
  name: string;
  effect: PolicyEffect;
  /** Tool names this rule applies to. Omit or `["*"]` for all tools. */
  tools?: string[];
  conditions?: {
    /** Max USDC micro-units (6 decimals) per single call */
    maxAmountPerCall?: number;
    /** Max cumulative USDC micro-units per session */
    maxAmountPerSession?: number;
    /** Allowed hours (0-23) in local time. Empty = any time. */
    allowedHours?: { start: number; end: number };
    /** Max number of calls per tool per session */
    maxCallsPerTool?: number;
  };
}

export interface PolicyDecision {
  allowed: boolean;
  rule?: string;
  reason?: string;
}

interface SessionLedger {
  totalSpent: number;
  callCounts: Record<string, number>;
}

export class PolicyEngine {
  private rules: PolicyRule[];
  private ledger: SessionLedger;
  private sessionId: string;

  constructor(rules: PolicyRule[], sessionId?: string) {
    this.rules = rules;
    this.sessionId = sessionId ?? crypto.randomUUID();
    this.ledger = { totalSpent: 0, callCounts: {} };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getLedger(): Readonly<SessionLedger> {
    return this.ledger;
  }

  /**
   * Evaluate whether a tool call is permitted.
   * Cedar semantics: default-deny, any matching `forbid` overrides `permit`.
   */
  evaluate(toolName: string, amountMicroUsdc: number): PolicyDecision {
    const matchingRules = this.rules.filter(
      (r) =>
        !r.tools || r.tools.length === 0 || r.tools.includes("*") || r.tools.includes(toolName),
    );

    if (matchingRules.length === 0) {
      return { allowed: false, reason: "No matching policy rule (default-deny)" };
    }

    // Forbid-wins: check forbid rules first
    for (const rule of matchingRules.filter((r) => r.effect === "forbid")) {
      const violation = this.checkConditions(rule, toolName, amountMicroUsdc);
      if (violation.matches) {
        return { allowed: false, rule: rule.name, reason: violation.reason };
      }
    }

    // Check permit rules
    for (const rule of matchingRules.filter((r) => r.effect === "permit")) {
      const violation = this.checkConditions(rule, toolName, amountMicroUsdc);
      if (!violation.matches) {
        return { allowed: true, rule: rule.name };
      }
    }

    return { allowed: false, reason: "No permit rule satisfied conditions" };
  }

  /** Record a successful tool call in the session ledger. */
  recordCall(toolName: string, amountMicroUsdc: number): void {
    this.ledger.totalSpent += amountMicroUsdc;
    this.ledger.callCounts[toolName] = (this.ledger.callCounts[toolName] ?? 0) + 1;
  }

  private checkConditions(
    rule: PolicyRule,
    toolName: string,
    amountMicroUsdc: number,
  ): { matches: boolean; reason?: string } {
    const c = rule.conditions;
    if (!c) return { matches: false };

    if (c.maxAmountPerCall !== undefined && amountMicroUsdc > c.maxAmountPerCall) {
      return {
        matches: true,
        reason: `Amount ${amountMicroUsdc} exceeds per-call limit ${c.maxAmountPerCall} (rule: ${rule.name})`,
      };
    }

    if (
      c.maxAmountPerSession !== undefined &&
      this.ledger.totalSpent + amountMicroUsdc > c.maxAmountPerSession
    ) {
      return {
        matches: true,
        reason: `Session spend ${this.ledger.totalSpent} + ${amountMicroUsdc} exceeds session limit ${c.maxAmountPerSession} (rule: ${rule.name})`,
      };
    }

    if (c.maxCallsPerTool !== undefined) {
      const current = this.ledger.callCounts[toolName] ?? 0;
      if (current >= c.maxCallsPerTool) {
        return {
          matches: true,
          reason: `Tool ${toolName} already called ${current} times, limit is ${c.maxCallsPerTool} (rule: ${rule.name})`,
        };
      }
    }

    if (c.allowedHours) {
      const hour = new Date().getHours();
      const { start, end } = c.allowedHours;
      const inWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
      if (!inWindow) {
        return {
          matches: true,
          reason: `Current hour ${hour} outside allowed window ${start}–${end} (rule: ${rule.name})`,
        };
      }
    }

    return { matches: false };
  }
}

/**
 * Default policy for the naive buyer demo:
 * - Permit all tools with a 0.05 USDC session budget (~50000 micro-USDC)
 * - Max 0.025 USDC per single call
 * - Max 2 calls per tool per session
 */
export function createDefaultPolicy(sessionId?: string): PolicyEngine {
  const rules: PolicyRule[] = [
    {
      name: "session-budget",
      effect: "permit",
      tools: ["*"],
      conditions: {
        maxAmountPerSession: 50000,
        maxAmountPerCall: 25000,
        maxCallsPerTool: 2,
      },
    },
  ];
  return new PolicyEngine(rules, sessionId);
}
