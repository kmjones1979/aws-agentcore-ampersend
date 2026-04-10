/**
 * ClawRouter / BlockRun LLM client — HTTP x402 with **EOA EIP-712** signatures.
 *
 * **Why not Ampersend `SmartAccountWallet` here?** BlockRun’s verifier follows
 * [ClawRouter’s `x402.ts`](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts):
 * `viem` **`signTypedData` + `privateKey`** → standard **ECDSA** USDC **TransferWithAuthorization**.
 * `SmartAccountWallet` instead produces **ERC-1271** (Safe + OwnableValidator / Rhinestone) payloads;
 * BlockRun’s on-chain check expects the ClawRouter wire format → **`PAYMENT_INVALID` / revert**
 * if you send smart-account signatures.
 *
 * **MCP tool leg:** buyer still pays `SELLER_WALLET_ADDRESS` (often a smart account) via Ampersend.
 * **BlockRun leg:** must be a **funded EOA** — use `SELLER_BLOCKRUN_PRIVATE_KEY` or `SELLER_PRIVATE_KEY`
 * whose **derived address holds Base mainnet USDC** (can differ from `SELLER_WALLET_ADDRESS`).
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
const DEFAULT_NETWORK = "eip155:8453";
const DEFAULT_MAX_TIMEOUT_SECONDS = 300;
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

function normalizeNetwork(network: string | undefined): string {
  if (!network || network.trim().length === 0) {
    return DEFAULT_NETWORK;
  }
  return network.trim().toLowerCase();
}

function resolveChainId(network: string): number {
  const eip155Match = network.match(/^eip155:(\d+)$/i);
  if (eip155Match) {
    const parsed = Number.parseInt(eip155Match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (network === "base") return BASE_CHAIN_ID;
  if (network === "base-sepolia") return BASE_SEPOLIA_CHAIN_ID;
  return BASE_CHAIN_ID;
}

function parseHexAddress(value: string | undefined): Hex | undefined {
  if (!value) return undefined;

  const direct = value.match(/^0x[a-fA-F0-9]{40}$/i);
  if (direct) {
    return direct[0] as Hex;
  }

  const suffix = value.match(/0x[a-fA-F0-9]{40}$/i);
  if (suffix) {
    return suffix[0] as Hex;
  }

  return undefined;
}

function requireHexAddress(value: string | undefined, field: string): Hex {
  const parsed = parseHexAddress(value);
  if (!parsed) {
    throw new Error(`Invalid ${field} in payment requirements: ${String(value)}`);
  }
  return parsed;
}

function resolveBlockrunEoaPrivateKey(): Hex | undefined {
  const dedicated = process.env.SELLER_BLOCKRUN_PRIVATE_KEY?.trim() as Hex | undefined;
  const fallback = process.env.SELLER_PRIVATE_KEY?.trim() as Hex | undefined;
  return dedicated || fallback;
}

async function createPaymentPayload(
  privateKey: Hex,
  fromAddress: string,
  option: PaymentOption,
  amount: string,
  requestUrl: string,
  resource: PaymentRequired["resource"],
): Promise<string> {
  const network = normalizeNetwork(option.network);
  const chainId = resolveChainId(network);
  const recipient = requireHexAddress(option.payTo, "payTo");
  const verifyingContract = requireHexAddress(option.asset, "asset");
  const maxTimeoutSeconds =
    typeof option.maxTimeoutSeconds === "number" && option.maxTimeoutSeconds > 0
      ? Math.floor(option.maxTimeoutSeconds)
      : DEFAULT_MAX_TIMEOUT_SECONDS;

  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 600;
  const validBefore = now + maxTimeoutSeconds;
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

function createClawRouterStyleFetch(privateKey: Hex): typeof fetch {
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
      `[clawrouter] x402 payment: ${amount} micro-USDC to ${option.payTo} on ${option.network} (EOA payer ${walletAddress})`,
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

let x402FetchPromise: Promise<typeof fetch> | null = null;

async function resolveX402Fetch(): Promise<typeof fetch> {
  if (x402FetchPromise) return x402FetchPromise;

  x402FetchPromise = (async (): Promise<typeof fetch> => {
    const pk = resolveBlockrunEoaPrivateKey();
    if (!pk) {
      console.warn(
        "[clawrouter] Set SELLER_BLOCKRUN_PRIVATE_KEY or SELLER_PRIVATE_KEY (EOA with Base USDC for BlockRun).",
      );
      return fetch;
    }

    const account = privateKeyToAccount(pk);
    console.log(
      `[clawrouter] BlockRun payer (EOA, ClawRouter-compatible): ${account.address}`,
    );
    return createClawRouterStyleFetch(pk);
  })();

  return x402FetchPromise;
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
  const f = await resolveX402Fetch();

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
    console.error("[clawrouter] BlockRun / ClawRouter call failed:", msg);
    throw error instanceof Error ? error : new Error(msg);
  }
}
