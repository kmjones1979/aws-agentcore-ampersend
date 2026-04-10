# AgentCore + Ampersend SDK + ClawRouter — Proof of Concept

TypeScript POC combining **AWS Bedrock AgentCore** (agent hosting), **Ampersend SDK** (x402 payment protocol), and **ClawRouter** (smart LLM routing) to demonstrate paid AI agent services with both buyer and seller roles.

> **Branch `blockrun-ampersend`**: Uses [ClawRouter](https://github.com/edgeandnode/ClawRouter) (`blockrun.ai/api`) as the LLM backend. The seller pays BlockRun with **x402** using the same **EIP-712 `TransferWithAuthorization`** flow as ClawRouter’s own proxy ([`src/x402.ts`](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts)), implemented with **viem** (`SELLER_PRIVATE_KEY`). Buyer-side tool payments still use **Ampersend SDK** (`withX402Payment`, MCP client, etc.). The [AgentCore wallet pattern](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments) (Coinbase CDP or `BUYER_PRIVATE_KEY`) applies to buyers only.

## Architecture

```
  NextJS Dashboard (:3000)
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │          Buyer Patterns                      │
  │  (AgentCore Wallet — Coinbase CDP)           │
  │                                              │
  │  ┌──────────┐ ┌───────────┐ ┌────────────┐  │
  │  │  Naive    │ │ Ampersend │ │ MCP Proxy  │  │
  │  │ Treasurer │ │ Treasurer │ │   (:8402)  │  │
  │  │ (test)    │ │ (prod)    │ │            │  │
  │  └─────┬────┘ └─────┬─────┘ └──────┬─────┘  │
  └────────┼─────────────┼──────────────┼─────────┘
           │             │              │
           └─────────────┼──────────────┘
                         │ x402 payment
                         ▼
  ┌──────────────────────────────────────────────┐
  │          Seller Agent (:8000)                 │
  │  FastMCP + withX402Payment middleware          │
  │                                               │
  │  research_topic   0.01  USDC                  │
  │  summarize_text   0.005 USDC                  │
  │  generate_code    0.02  USDC                  │
  │                    │                          │
  │                    │ x402 (EIP-712 USDC, Base) │
  │                    ▼                          │
  │       ClawRouter (blockrun.ai/api)            │
  │       OpenAI-compatible chat completions      │
  └───────────────────────────────────────────────┘
```

The seller is **both a seller and a buyer**:
- Sells AI tools to clients via x402 (**Ampersend** `withX402Payment` on FastMCP)
- Buys LLM inference from ClawRouter via x402 (**viem** signing; not the ampersend HTTP wrapper)

`SELLER_WALLET_ADDRESS` is where **buyers** send USDC (matches `CHAIN_NETWORK`, usually Base Sepolia). `SELLER_PRIVATE_KEY` must fund **ClawRouter** on **Base mainnet** — the derived address may differ from `SELLER_WALLET_ADDRESS`.

## What This Demonstrates

| Use Case | Component | Key Feature |
|---|---|---|
| **Seller** — charge for AI tools | `packages/seller` | `withX402Payment` + ClawRouter LLM backend |
| **LLM payment** — pay-per-request AI | `packages/seller/clawrouter.ts` | viem EIP-712 x402 (ClawRouter-compatible) → `blockrun.ai/api` |
| **Buyer (test)** — auto-approve | `packages/buyer/naive-buyer.ts` | AgentCore wallet + NaiveTreasurer |
| **Buyer (prod)** — spend-limited | `packages/buyer/mcp-buyer.ts` | AgentCore wallet + AmpersendTreasurer |
| **HTTP buyer** — paid HTTP calls | `packages/buyer/http-buyer.ts` | AgentCore wallet + `@x402/fetch` + ampersend treasurer |
| **MCP Proxy** — transparent proxy | `packages/buyer/proxy.ts` | AgentCore wallet + payment proxy |
| **AgentCore agent** — autonomous buyer | `app/AgentBuyer/agent.ts` | BedrockAgentCoreApp + AgentCore wallet |
| **Dashboard** — visualize flows | `packages/web` | NextJS UI |

## Key Changes (vs `main` branch)

1. **ClawRouter replaces Bedrock** — The seller calls `blockrun.ai/api/v1/chat/completions` (OpenAI-compatible). On 402, the seller signs USDC on **Base mainnet** using the same payload format as ClawRouter’s proxy (not the ampersend `wrapFetchWithPayment` path used for generic HTTP).

2. **AgentCore Wallet** — All buyer-side x402 payments use the Coinbase CDP wallet pattern (from the [AWS AgentCore x402 sample](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments)). Wallet credentials come from CDP API keys (production) or a raw private key (testing).

## Prerequisites

- **Node.js 20+** and **pnpm**
- **Coinbase Developer Platform** account ([portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)) — optional; you can use `BUYER_PRIVATE_KEY` for local testing instead
- **USDC on Base Sepolia** — fund the **buyer** wallet (and optionally align `SELLER_WALLET_ADDRESS`) for tool payments when `CHAIN_NETWORK=base-sepolia`
- **USDC on Base mainnet** — fund the address derived from **`SELLER_PRIVATE_KEY`** so the seller can pay ClawRouter (BlockRun settles on mainnet)
- **Docker** (optional, for AgentCore container deployment)

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Option A: CDP (production) — all three required for AgentKit
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-key-secret
CDP_WALLET_SECRET=your-wallet-secret

# Option B: Raw private key (testing, no CDP)
BUYER_PRIVATE_KEY=0x...

# Seller config
SELLER_WALLET_ADDRESS=0x...    # receives USDC from buyers (testnet address)
SELLER_PRIVATE_KEY=0x...       # signs ClawRouter x402 — fund this address on Base mainnet

# ClawRouter model (direct API — not the OpenClaw local proxy)
# Use a concrete model id, e.g. claude-haiku-4.5, gpt-5-mini (see BlockRun 402 error / docs)
CLAWROUTER_MODEL=claude-haiku-4.5
```

### 3. Start the seller

```bash
pnpm seller:dev
# FastMCP server on http://localhost:8000/mcp
# LLM backend: ClawRouter via x402
```

### 4. Run a buyer

```bash
# Naive buyer (auto-approves, uses AgentCore wallet)
pnpm buyer:naive

# Or with Ampersend spend limits
pnpm buyer:mcp
```

### 5. Start the dashboard

```bash
pnpm web:dev
# Open http://localhost:3000
```

## AgentCore Wallet Provider

The `AgentCoreWalletProvider` (`packages/buyer/src/agentcore-wallet.ts`) integrates **Coinbase AgentKit** [`CdpEvmWalletProvider`](https://github.com/coinbase/agentkit) when CDP credentials are present, and bridges it to a viem `LocalAccount` via `toAccount` so Ampersend’s `AccountWallet` can call `x402`’s `createPaymentHeader` (see `packages/buyer/src/cdp-viem-account.ts`).

```typescript
import { createAgentCoreWallet } from "./agentcore-wallet.js";

// 1. CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET → real CDP server wallet (mode "cdp")
// 2. BUYER_PRIVATE_KEY → local EOA (mode "local")
// 3. Neither → ephemeral wallet (unfunded)
const wallet = await createAgentCoreWallet();

console.log(wallet.getAddress());   // 0x...
console.log(wallet.getMode());      // "cdp" | "local"
wallet.getCdpProvider();            // CdpEvmWalletProvider | null (CDP only)

const treasurer = wallet.createNaiveTreasurer();
```

In production, store **CDP_API_KEY_ID**, **CDP_API_KEY_SECRET**, and **CDP_WALLET_SECRET** in **AWS Secrets Manager** (or inject via AgentCore environment) — never commit them.

## AgentCore container agent (`app/AgentBuyer`)

The **runtime wiring is correct** for a bring-your-own-container agent: `BedrockAgentCoreApp` handles HTTP invocations, and each request uses the Ampersend MCP `Client` + `StreamableHTTPClientTransport` to call the seller’s paid tools with a `NaiveTreasurer` backed by `AccountWallet`.

**What you must configure for a real deployment**

| Item | Status |
|------|--------|
| `BedrockAgentCoreApp` + `invocationHandler.process` | Correct |
| Wallet resolution | **CDP:** `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` + `CDP_WALLET_SECRET` → AgentKit `CdpEvmWalletProvider` (real server-side signing). **Fallback:** `BUYER_PRIVATE_KEY` for local EOA. `app/AgentBuyer` imports `createAgentCoreWallet` from `@poc/buyer/agentcore-wallet`. |
| **`SELLER_URL`** | **Required.** Defaults to `http://localhost:8000/mcp`, which only works on your laptop. In AgentCore, set this to a **publicly reachable** seller URL (HTTPS, correct path). The agent cannot reach `localhost` inside the container. |
| Secrets | Prefer **Secrets Manager** / runtime env for **CDP** vars or `BUYER_PRIVATE_KEY`; do not bake into the image. |
| `agentcore/agentcore.json` shows `PYTHON_3_12` / `main.py` | **Normal for container agents.** AWS documents that for `build: Container`, those fields are placeholders; the **Dockerfile `CMD`** is what actually runs ([TypeScript container guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html)). |
| New MCP connection per invocation | Fine for a POC; reuse a client if you need higher throughput. |

Local run (optional): `agent.ts` walks up parent directories and loads the first `.env` found (usually the repo root). In AgentCore, environment variables are injected by the platform instead.

**Container image:** build from the **repository root** (workspace packages required):

```bash
docker build -f app/AgentBuyer/Dockerfile .
```

## ClawRouter Integration

`packages/seller/src/clawrouter.ts` implements an x402-aware `fetch` that mirrors ClawRouter’s [`createPaymentFetch`](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts): parse `x-payment-required`, sign **EIP-712 `TransferWithAuthorization`**, retry with `x-payment` / `payment-signature`.

```typescript
import { askClawRouter } from "./clawrouter.js";

const response = await askClawRouter("Explain quantum computing");
```

Pick a **concrete** `CLAWROUTER_MODEL` supported by the live API. Routing profiles such as `blockrun/auto` are for the **local** ClawRouter/OpenClaw proxy, not the bare `https://blockrun.ai/api` endpoint used here.

## Project Structure

```
aws-agentcore-ampersend/
├── packages/
│   ├── seller/
│   │   └── src/
│   │       ├── index.ts            # FastMCP server with paid tools
│   │       └── clawrouter.ts       # BlockRun API + viem x402 (ClawRouter-compatible)
│   ├── buyer/
│   │   └── src/
│   │       ├── agentcore-wallet.ts # AgentCore wallet provider (CDP)
│   │       ├── naive-buyer.ts      # NaiveTreasurer buyer
│   │       ├── mcp-buyer.ts        # AmpersendTreasurer buyer
│   │       ├── http-buyer.ts       # HTTP x402 buyer
│   │       └── proxy.ts            # MCP payment proxy
│   └── web/                        # NextJS dashboard
├── app/AgentBuyer/                 # AgentCore container agent
├── agentcore/                      # AgentCore CLI config
└── .env.example
```

## Technologies

- [AWS Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/) — Agent hosting
- [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk) — x402 payment protocol
- [ClawRouter](https://github.com/edgeandnode/ClawRouter) — Smart LLM routing (41+ models)
- [x402](https://github.com/coinbase/x402) — Micropayment protocol (USDC)
- [Coinbase CDP](https://docs.cdp.coinbase.com/) + [AgentKit](https://docs.cdp.coinbase.com/agent-kit/docs/welcome) — Buyer wallet (`CdpEvmWalletProvider`)
- [Next.js](https://nextjs.org) + [Tailwind CSS](https://tailwindcss.com) — Dashboard

## License

See repository root for license terms (add a `LICENSE` file if none is present).
