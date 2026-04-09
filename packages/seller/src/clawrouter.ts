/**
 * ClawRouter LLM client — calls BlockRun's OpenAI-compatible API
 * with ampersend-sdk x402 payment handling in front.
 *
 * The seller is BOTH:
 *  - A seller of tool services (charges buyers via FastMCP x402 middleware)
 *  - A buyer of LLM services (pays ClawRouter via ampersend-sdk HTTP x402)
 *
 * Flow: seller → ampersend x402 fetch → blockrun.ai/api → 402 → pay → LLM response
 */

import {
  AccountWallet,
  wrapWithAmpersend,
} from "@ampersend_ai/ampersend-sdk/x402";
import type {
  X402Treasurer,
  Authorization,
  PaymentContext,
  PaymentStatus,
} from "@ampersend_ai/ampersend-sdk/x402";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const BLOCKRUN_API = "https://blockrun.ai/api";

class LlmTreasurer implements X402Treasurer {
  constructor(private wallet: InstanceType<typeof AccountWallet>) {}

  async onPaymentRequired(
    requirements: ReadonlyArray<any>,
    _context?: PaymentContext,
  ): Promise<Authorization | null> {
    if (requirements.length === 0) return null;
    console.log(
      `[clawrouter] Paying for LLM call — ${requirements[0].maxAmountRequired} (${requirements[0].asset})`,
    );
    const payment = await this.wallet.createPayment(requirements[0]);
    return { payment, authorizationId: crypto.randomUUID() };
  }

  async onStatus(
    status: PaymentStatus,
    authorization: Authorization,
  ): Promise<void> {
    console.log(
      `[clawrouter] LLM payment ${authorization.authorizationId}: ${status}`,
    );
  }
}

let paymentFetch: typeof fetch | null = null;

function getPaymentFetch(): typeof fetch {
  if (paymentFetch) return paymentFetch;

  const sellerKey = process.env.SELLER_PRIVATE_KEY;
  if (!sellerKey) {
    console.warn(
      "[clawrouter] SELLER_PRIVATE_KEY not set — x402 payments to BlockRun disabled, using plain fetch",
    );
    paymentFetch = fetch;
    return fetch;
  }

  const wallet = AccountWallet.fromPrivateKey(sellerKey as `0x${string}`);
  const treasurer = new LlmTreasurer(wallet);
  const client = new x402Client();
  wrapWithAmpersend(client, treasurer, ["base-sepolia", "base"]);
  paymentFetch = wrapFetchWithPayment(fetch, client);
  return paymentFetch;
}

export interface ClawRouterOptions {
  model?: string;
  maxTokens?: number;
}

/**
 * Call ClawRouter's OpenAI-compatible chat completion endpoint.
 * ampersend-sdk handles x402 payment automatically when BlockRun returns 402.
 */
export async function askClawRouter(
  prompt: string,
  opts: ClawRouterOptions = {},
): Promise<string> {
  const model = opts.model ?? process.env.CLAWROUTER_MODEL ?? "blockrun/auto";
  const maxTokens = opts.maxTokens ?? 1024;
  const f = getPaymentFetch();

  try {
    const res = await f(`${BLOCKRUN_API}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ClawRouter ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return (
      data.choices?.[0]?.message?.content ??
      JSON.stringify(data) ??
      "No response from model."
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("[clawrouter] Call failed, using mock response:", msg);
    return `[Mock response — ClawRouter unavailable] Simulated answer for: "${prompt}"`;
  }
}
