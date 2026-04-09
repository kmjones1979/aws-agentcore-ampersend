/**
 * ClawRouter LLM client — calls BlockRun's OpenAI-compatible API
 * with x402 payment handling matching ClawRouter's own protocol.
 *
 * Uses the same EIP-712 TransferWithAuthorization signing that
 * ClawRouter's local proxy uses (`SELLER_PRIVATE_KEY` via viem).
 */

import { signTypedData, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const BLOCKRUN_API = "https://blockrun.ai/api";

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const DEFAULT_TOKEN_NAME = "USD Coin";
const DEFAULT_TOKEN_VERSION = "2";
const BASE_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;

interface PaymentOption {
  scheme: string;
  network: string;
  amount?: string;
  maxAmountRequired?: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

interface PaymentRequired {
  accepts: PaymentOption[];
  resource?: { url?: string; description?: string };
}

function createNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}

function decodeBase64Json<T>(value: string): T {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padding);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function resolveChainId(network: string): number {
  const eip155Match = network.match(/^eip155:(\d+)$/i);
  if (eip155Match) return Number.parseInt(eip155Match[1], 10);
  if (network === "base") return BASE_CHAIN_ID;
  if (network === "base-sepolia") return BASE_SEPOLIA_CHAIN_ID;
  return BASE_CHAIN_ID;
}

function parseHexAddress(value: string | undefined): Hex | undefined {
  if (!value) return undefined;
  const match = value.match(/0x[a-fA-F0-9]{40}$/);
  return match ? (match[0] as Hex) : undefined;
}

async function createPaymentPayload(
  privateKey: Hex,
  fromAddress: string,
  option: PaymentOption,
  amount: string,
  requestUrl: string,
  resource: PaymentRequired["resource"],
): Promise<string> {
  const network = option.network?.trim().toLowerCase() || "eip155:8453";
  const chainId = resolveChainId(network);
  const recipient = parseHexAddress(option.payTo)!;
  const verifyingContract = parseHexAddress(option.asset)!;
  const maxTimeout = option.maxTimeoutSeconds ?? 300;

  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 600;
  const validBefore = now + maxTimeout;
  const nonce = createNonce();

  const signature = await signTypedData({
    privateKey,
    domain: {
      name: option.extra?.name || DEFAULT_TOKEN_NAME,
      version: option.extra?.version || DEFAULT_TOKEN_VERSION,
      chainId,
      verifyingContract,
    },
    types: TRANSFER_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: fromAddress as Hex,
      to: recipient,
      value: BigInt(amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });

  return encodeBase64Json({
    x402Version: 2,
    resource: {
      url: resource?.url || requestUrl,
      description: resource?.description || "BlockRun AI API call",
      mimeType: "application/json",
    },
    accepted: {
      scheme: option.scheme,
      network,
      amount,
      asset: option.asset,
      payTo: option.payTo,
      maxTimeoutSeconds: option.maxTimeoutSeconds,
      extra: option.extra,
    },
    payload: {
      signature,
      authorization: {
        from: fromAddress,
        to: recipient,
        value: amount,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
    extensions: {},
  });
}

// ---------------------------------------------------------------------------
// x402-aware fetch wrapper (matches ClawRouter's own protocol)
// ---------------------------------------------------------------------------

function createX402Fetch(privateKey: Hex): typeof fetch {
  const account = privateKeyToAccount(privateKey);
  const walletAddress = account.address;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    const response = await fetch(input, init);

    if (response.status !== 402) return response;

    const paymentHeader = response.headers.get("x-payment-required");
    if (!paymentHeader) {
      throw new Error("402 response missing x-payment-required header");
    }

    const paymentRequired = decodeBase64Json<PaymentRequired>(paymentHeader);
    const option = paymentRequired.accepts?.[0];
    if (!option) throw new Error("No payment options in 402 response");

    const amount = option.amount || option.maxAmountRequired;
    if (!amount) throw new Error("No amount in payment requirements");

    console.log(
      `[clawrouter] x402 payment: ${amount} micro-USDC to ${option.payTo} on ${option.network}`,
    );

    const paymentPayload = await createPaymentPayload(
      privateKey,
      walletAddress,
      option,
      amount,
      url,
      paymentRequired.resource,
    );

    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("payment-signature", paymentPayload);
    retryHeaders.set("x-payment", paymentPayload);

    return fetch(input, { ...init, headers: retryHeaders });
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let x402Fetch: typeof fetch | null = null;

function getX402Fetch(): typeof fetch {
  if (x402Fetch) return x402Fetch;

  const sellerKey = process.env.SELLER_PRIVATE_KEY as Hex | undefined;
  if (!sellerKey) {
    console.warn(
      "[clawrouter] SELLER_PRIVATE_KEY not set — x402 payments disabled, using plain fetch",
    );
    x402Fetch = fetch;
    return fetch;
  }

  const account = privateKeyToAccount(sellerKey);
  console.log(`[clawrouter] x402 wallet: ${account.address}`);
  x402Fetch = createX402Fetch(sellerKey);
  return x402Fetch;
}

export interface ClawRouterOptions {
  model?: string;
  maxTokens?: number;
}

export async function askClawRouter(
  prompt: string,
  opts: ClawRouterOptions = {},
): Promise<string> {
  const model = opts.model ?? process.env.CLAWROUTER_MODEL ?? "blockrun/auto";
  const maxTokens = opts.maxTokens ?? 1024;
  const f = getX402Fetch();

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
      throw new Error(`ClawRouter ${res.status}: ${text.slice(0, 500)}`);
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
