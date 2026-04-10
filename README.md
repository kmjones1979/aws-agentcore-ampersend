# AgentCore + Ampersend SDK + ClawRouter — Proof of Concept

TypeScript POC combining **AWS Bedrock AgentCore** (agent hosting), **Ampersend SDK** (x402 on MCP/HTTP), and **BlockRun / ClawRouter** (`blockrun.ai/api`) for LLM inference behind paid tools.

**Branch `blockrun-ampersend`** extends the base POC with:

- **Seller → LLM:** x402 payments to BlockRun using the same **EIP-712 `TransferWithAuthorization`** pattern as [ClawRouter’s proxy](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts), implemented with **viem** and `SELLER_PRIVATE_KEY` (not Ampersend’s generic HTTP wrapper for that hop).
- **Buyer → seller:** x402 tool payments via **Ampersend** (`withX402Payment`, MCP client). The buyer wallet is either **Coinbase CDP + AgentKit** (`CdpEvmWalletProvider`) or a **local EOA** (`BUYER_PRIVATE_KEY`), following the [AgentCore x402 sample](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments) idea (secrets in prod, env for dev).

---

## Contents

- [Architecture](#architecture)
- [What this demonstrates](#what-this-demonstrates)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Quick start](#quick-start)
- [Scripts (root)](#scripts-root)
- [AgentCore wallet (CDP + Ampersend)](#agentcore-wallet-cdp--ampersend)
- [AgentCore container agent](#agentcore-container-agent)
- [ClawRouter / BlockRun (seller LLM)](#clawrouter--blockrun-seller-llm)
- [Testing & troubleshooting](#testing--troubleshooting)
- [Project structure](#project-structure)
- [Technologies](#technologies)
- [License](#license)

---

## Architecture

```
  Next.js dashboard (:3000)
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │  Buyer (packages/buyer, packages/web API)    │
  │  AgentCore agent (app/AgentBuyer)            │
  │                                               │
  │  Wallet: CDP (AgentKit) OR BUYER_PRIVATE_KEY  │
  │  Treasurer → Ampersend MCP / x402 client     │
  └───────────────────────┬─────────────────────┘
                          │ x402 (tool payment)
                          ▼
  ┌──────────────────────────────────────────────┐
  │  Seller — FastMCP :8000                       │
  │  withX402Payment · research / summarize / code│
  │                    │                          │
  │                    │ x402 → BlockRun (LLM)    │
  │                    ▼                          │
  │       blockrun.ai/api (OpenAI-compatible)    │
  └──────────────────────────────────────────────┘
```

**Two different “buyer” roles:**

| Role | Who pays | Chain / asset (typical) | Implementation |
|------|-----------|---------------------------|----------------|
| **Tool buyer** | Client calling MCP | `CHAIN_NETWORK` (e.g. Base Sepolia USDC) | Ampersend + CDP or `BUYER_PRIVATE_KEY` |
| **LLM buyer** | Seller process | **Base mainnet** USDC to BlockRun | `SELLER_PRIVATE_KEY` + viem EIP-712 in `clawrouter.ts` |

`SELLER_WALLET_ADDRESS` receives buyer tool payments. The address derived from **`SELLER_PRIVATE_KEY`** pays BlockRun and may **differ** from `SELLER_WALLET_ADDRESS`.

---

## What this demonstrates

| Use case | Location | Notes |
|----------|----------|--------|
| Seller (paid tools) | `packages/seller` | FastMCP + `withX402Payment` |
| LLM (BlockRun) | `packages/seller/clawrouter.ts` | x402 fetch; EIP-712 compatible with BlockRun |
| Naive buyer | `packages/buyer/naive-buyer.ts` | `createAgentCoreWallet` + Naive treasurer |
| Spend limits | `packages/buyer/mcp-buyer.ts` | Ampersend treasurer when smart account configured |
| HTTP x402 | `packages/buyer/http-buyer.ts` | `@x402/fetch` + Ampersend |
| MCP proxy | `packages/buyer/proxy.ts` | Transparent proxy |
| Bedrock AgentCore | `app/AgentBuyer/agent.ts` | Imports `@poc/buyer/agentcore-wallet` |
| Dashboard | `packages/web` | Next.js |

---

## Prerequisites

- **Node.js 20+** and **pnpm** (see root `packageManager` in `package.json`)
- **Coinbase Developer Platform** ([portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)) if you use **CDP mode** (three secrets below)
- **USDC**
  - On **Base Sepolia** for tool buyers when `CHAIN_NETWORK=base-sepolia`
  - On **Base mainnet** for the **seller LLM payer** (address from `SELLER_PRIVATE_KEY`)
- **Docker** — optional; required to build the AgentBuyer image (see [Container image](#agentcore-container-agent))

---

## Environment variables

Copy **`.env.example`** → **`.env`** at the **repository root** (scripts load it from there).

| Variable | Required | Purpose |
|----------|----------|---------|
| `CDP_API_KEY_ID` | For CDP mode | Coinbase CDP API key id |
| `CDP_API_KEY_SECRET` | For CDP mode | CDP API secret |
| `CDP_WALLET_SECRET` | For CDP mode | CDP wallet secret (AgentKit [requires all three](https://github.com/coinbase/agentkit)) |
| `CDP_WALLET_ADDRESS` | Optional | Use an existing CDP EVM account instead of creating one |
| `BUYER_PRIVATE_KEY` | If **not** using full CDP | Local EOA for x402 signing (testing) |
| `SELLER_WALLET_ADDRESS` | Recommended | Address that receives tool payments |
| `SELLER_PRIVATE_KEY` | For real LLM responses | Signs x402 to BlockRun; fund on **Base mainnet** |
| `CHAIN_NETWORK` | Optional | e.g. `base-sepolia` (buyer↔seller) |
| `CLAWROUTER_MODEL` | Optional | Concrete model id, e.g. `claude-haiku-4.5` (not `blockrun/auto` on the bare HTTP API) |
| `SELLER_URL` | AgentCore / remote | Seller MCP URL (must be reachable from the agent, not `localhost` in cloud) |

**Wallet selection (buyer):**

1. If **`CDP_API_KEY_ID`**, **`CDP_API_KEY_SECRET`**, and **`CDP_WALLET_SECRET`** are all set → **CDP / AgentKit** (`getMode()` → `"cdp"`).
2. Else if **`BUYER_PRIVATE_KEY`** is set → **local EOA** (`"local"`).
3. Else → **ephemeral** unfunded wallet (demo only).

Use **either** full CDP **or** `BUYER_PRIVATE_KEY` for predictable behavior; avoid leaving stray `BUYER_PRIVATE_KEY` in `.env` when you intend to test CDP only.

---

## Quick start

```bash
pnpm install
cp .env.example .env
# Edit .env — CDP (three vars) OR BUYER_PRIVATE_KEY; configure seller keys and CLAWROUTER_MODEL

pnpm seller:dev    # terminal 1 — http://localhost:8000/mcp
pnpm buyer:naive   # terminal 2
pnpm web:dev       # optional — http://localhost:3000
```

---

## Scripts (root)

| Script | Description |
|--------|-------------|
| `pnpm seller:dev` | FastMCP seller with ClawRouter/BlockRun backend |
| `pnpm buyer:naive` | MCP buyer with `createAgentCoreWallet` |
| `pnpm buyer:mcp` | Buyer with Ampersend treasurer (smart account env optional) |
| `pnpm buyer:http` | HTTP x402 sample |
| `pnpm buyer:proxy` | MCP payment proxy |
| `pnpm web:dev` | Next.js app |
| `pnpm build` | Build all workspace packages (including `app/AgentBuyer`) |

---

## AgentCore wallet (CDP + Ampersend)

Implementation: `packages/buyer/src/agentcore-wallet.ts` + `packages/buyer/src/cdp-viem-account.ts`.

[Coinbase AgentKit](https://github.com/coinbase/agentkit) **`CdpEvmWalletProvider`** performs server-side signing. The code wraps it with **viem `toAccount()`** so **`AccountWallet`** can use **`x402`’s `createPaymentHeader`** (EIP-3009 style payments used by Ampersend).

```typescript
import { createAgentCoreWallet } from "./agentcore-wallet.js";

const wallet = await createAgentCoreWallet();
console.log(wallet.getAddress(), wallet.getMode()); // "cdp" | "local"
wallet.getCdpProvider(); // CdpEvmWalletProvider | null

const treasurer = wallet.createNaiveTreasurer();
```

**Export for other packages:** `@poc/buyer/agentcore-wallet` (see `packages/buyer/package.json` `"exports"`).

Production: load CDP secrets from **AWS Secrets Manager** (or AgentCore-injected env), never commit `.env`.

---

## AgentCore container agent

- **`app/AgentBuyer`** is part of the **pnpm workspace** and depends on **`@poc/buyer`**.
- Set **`SELLER_URL`** to a **public** seller MCP URL when deploying; `http://localhost:8000/mcp` only works locally.
- **`agentcore/agentcore.json`**: `PYTHON_3_12` / `main.py` are **placeholders** for container builds; the image **`CMD`** from the Dockerfile is authoritative ([AWS TS container guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html)).

**Docker** (from **repository root**):

```bash
docker build -f app/AgentBuyer/Dockerfile .
```

The Dockerfile uses **`pnpm --filter agent-buyer deploy --legacy`** so the image includes pruned `node_modules` and `dist/`.

---

## ClawRouter / BlockRun (seller LLM)

Direct HTTP API: **`https://blockrun.ai/api/v1/chat/completions`**.

Use a **concrete** `CLAWROUTER_MODEL` supported by the live API. Profiles like **`blockrun/auto`** apply to the **local** ClawRouter/OpenClaw proxy, not necessarily to bare `blockrun.ai/api`.

---

## Testing & troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `[Mock response — ClawRouter unavailable]` | BlockRun x402 failed: fund **mainnet USDC** on the address from **`SELLER_PRIVATE_KEY`**, or wrong model / payload |
| `PAYMENT_INVALID` / verification errors (seller→BlockRun) | Wrong chain funding, or insufficient USDC on the **signing** address |
| Buyer payments fail on Sepolia | Fund the **buyer** wallet (CDP account or `BUYER_PRIVATE_KEY` address) with Sepolia USDC |
| CDP mode not used | All three of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` must be set; remove `BUYER_PRIVATE_KEY` if you only want CDP |

**Secrets in git:** `.env` is gitignored; use `.cursorignore` / `.claudeignore` patterns so editors don’t index secrets.

---

## Project structure

```
aws-agentcore-ampersend/
├── packages/
│   ├── seller/src/
│   │   ├── index.ts           # FastMCP + paid tools
│   │   └── clawrouter.ts      # BlockRun HTTP + viem x402
│   ├── buyer/src/
│   │   ├── agentcore-wallet.ts
│   │   ├── cdp-viem-account.ts  # CDP ↔ viem LocalAccount bridge
│   │   ├── naive-buyer.ts, mcp-buyer.ts, http-buyer.ts, proxy.ts
│   └── web/                   # Next.js dashboard
├── app/AgentBuyer/            # BedrockAgentCoreApp + @poc/buyer
├── agentcore/                 # AgentCore CLI metadata
├── .env.example
└── README.md
```

---

## Technologies

- [AWS Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/)
- [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk)
- [BlockRun / ClawRouter](https://github.com/edgeandnode/ClawRouter) — routing & `blockrun.ai` API
- [x402](https://github.com/coinbase/x402)
- [Coinbase CDP](https://docs.cdp.coinbase.com/) + [AgentKit](https://docs.cdp.coinbase.com/agent-kit/docs/welcome)
- [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com)
- [viem](https://viem.sh)

---

## License

Add a `LICENSE` file at the repository root if you distribute this project; this README does not specify a SPDX id by default.
