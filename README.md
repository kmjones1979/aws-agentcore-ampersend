# AWS Bedrock AgentCore × Ampersend × BlockRun — Proof of Concept

TypeScript monorepo that wires four pieces together:

1. **[Amazon Bedrock AgentCore](#amazon-bedrock--agentcore)** — host a **TypeScript** agent (`bedrock-agentcore` runtime) in AWS, with **Bedrock** as the configured model provider in project metadata.
2. **[Ampersend](#ampersend-sdk-buyer-to-seller-x402)** — **x402** micropayments on **MCP** for **buyer → seller** tool calls (`withX402Payment`, `AccountWallet`, treasurers).
3. **[BlockRun](#blockrun-and-clawrouter-seller-to-llm)** — **x402**-gated **LLM** API (`blockrun.ai`) behind seller tools; EIP-712 USDC transfer pattern aligned with [ClawRouter](https://github.com/edgeandnode/ClawRouter).
4. **Two payment legs:** tool fees (buyer pays `SELLER_WALLET_ADDRESS`) and LLM fees (address from `SELLER_PRIVATE_KEY` pays BlockRun on **Base mainnet**).

---

## Contents

- [Focus: the four products](#focus-the-four-products)
- [Architecture](#architecture)
- [Amazon Bedrock & AgentCore](#amazon-bedrock--agentcore)
- [Ampersend: buyer to seller (x402)](#ampersend-sdk-buyer-to-seller-x402)
- [BlockRun and ClawRouter: seller to LLM](#blockrun-and-clawrouter-seller-to-llm)
- [What this demonstrates](#what-this-demonstrates)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Quick start](#quick-start)
- [Scripts (root)](#scripts-root)
- [AgentCore wallet (CDP + Ampersend)](#agentcore-wallet-cdp--ampersend)
- [AgentCore container & deployment](#agentcore-container--deployment)
- [Testing on Base mainnet](#testing-on-base-mainnet)
- [Testing & troubleshooting](#testing--troubleshooting)
- [Project structure](#project-structure)
- [Technologies](#technologies)
- [License](#license)

---

## Focus: the four products

| Piece | What it is | In this repository |
|--------|------------|---------------------|
| **Amazon Bedrock AgentCore** | Managed runtime for agents ([docs](https://docs.aws.amazon.com/bedrock-agentcore/)) | `app/AgentBuyer` uses **`bedrock-agentcore`** (`BedrockAgentCoreApp`). `agentcore/agentcore.json` registers **AgentCore Runtime**, **Container** build, and **`modelProvider`: Bedrock**. |
| **Amazon Bedrock** | Foundation-model service used with AgentCore projects | Declared in **`agentcore.json`**. This POC’s **`agent.ts` does not invoke Bedrock `Converse` / chat APIs**—it maps user input to MCP tool calls. **LLM text** comes from **BlockRun** inside the seller (`clawrouter.ts`). |
| **Ampersend SDK** | x402 payments for agents (MCP, HTTP, treasurers) | Seller: **`withX402Payment`** (FastMCP). Buyers: **`AccountWallet`** + **`createNaiveTreasurer()`** after **`createAgentCoreWallet()`**. See [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk). |
| **BlockRun** | Paid LLM gateway (`blockrun.ai`) over x402 | Seller calls **`https://blockrun.ai/api/v1/chat/completions`** with **`SELLER_PRIVATE_KEY`**-signed USDC (**EIP-712 `TransferWithAuthorization`**), matching [ClawRouter’s x402 pattern](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts). |

**Funding (two seller-side roles):** fund the **buyer** wallet (CDP or `BUYER_PRIVATE_KEY`) for **tool** x402 to `SELLER_WALLET_ADDRESS`. Fund the address derived from **`SELLER_PRIVATE_KEY`** with **Base mainnet USDC** for **BlockRun**—that address is **not** necessarily the same as `SELLER_WALLET_ADDRESS`.

---

## Architecture

```
  Next.js dashboard (:3000)  ──POST /api/invoke──►
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │  Buyer (packages/buyer, packages/web API)  │
  │  AgentCore agent (app/AgentBuyer)            │
  │                                               │
  │  Wallet: CDP (AgentKit) OR BUYER_PRIVATE_KEY │
  │  NaiveTreasurer → Ampersend MCP / x402       │
  │  (dashboard “proxy” mode → separate process)│
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
| **Tool buyer** | Client calling MCP | `CHAIN_NETWORK` (e.g. Base Sepolia USDC) | `createAgentCoreWallet` + NaiveTreasurer (CDP or `BUYER_PRIVATE_KEY`) |
| **LLM buyer** | Seller process | **Base mainnet** USDC to BlockRun | `SELLER_PRIVATE_KEY` + viem EIP-712 in `clawrouter.ts` |

`SELLER_WALLET_ADDRESS` receives buyer tool payments. The address derived from **`SELLER_PRIVATE_KEY`** pays BlockRun and may **differ** from `SELLER_WALLET_ADDRESS`.

---

## Amazon Bedrock & AgentCore

- **Runtime:** [`bedrock-agentcore`](https://www.npmjs.com/package/bedrock-agentcore) provides **`BedrockAgentCoreApp`**. The handler receives invoke payloads (e.g. `prompt`), maps them to MCP tool names, and calls the seller over **Streamable HTTP**—same wallet pattern as **`createAgentCoreWallet`** (see `packages/buyer/src/agentcore-wallet.ts`) + NaiveTreasurer.
- **Bedrock in config:** `agentcore/agentcore.json` sets **`modelProvider`: `"Bedrock"`** so deployments align with [Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/). To add **in-process** Bedrock reasoning (e.g. tool planning via `Converse`), extend `agent.ts`; this POC keeps routing simple and uses **BlockRun** for LLM completions inside tools.
- **Deploy:** Set **`SELLER_URL`** to a **public** seller MCP URL when running in AWS; `localhost` only works locally. Build the image from the repo root: `docker build -f app/AgentBuyer/Dockerfile .`. The Dockerfile runs the compiled Node agent; **`PYTHON_3_12` / `main.py` in `agentcore.json` are placeholders**—see the [TypeScript container guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html).

---

## Ampersend SDK: buyer to seller (x402)

- **Seller:** `packages/seller` exposes paid tools with **`withX402Payment`** (FastMCP). Payment requirements use **`CHAIN_NETWORK`** and USDC on Base (Sepolia or mainnet).
- **Buyers:** `packages/buyer` and `packages/web` (`src/app/api/invoke/route.ts`) use **`createAgentCoreWallet()`** (CDP + AgentKit or `BUYER_PRIVATE_KEY`) and **`createNaiveTreasurer()`** so Ampersend’s **`AccountWallet`** signs x402 (EIP-3009 style) for tool calls.
- **Optional:** `mcp-buyer` can use **`AMPERSEND_SPEND_LIMIT_TREASURER=1`** with smart-account env vars for Ampersend’s API treasurer—off by default so signing stays on the AgentCore wallet path.

Implementation details: [AgentCore wallet (CDP + Ampersend)](#agentcore-wallet-cdp--ampersend). For CDP secrets in production, the same idea as [AWS’s AgentCore x402 sample](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments) applies (store in Secrets Manager, not git).

---

## BlockRun and ClawRouter: seller to LLM

- **API:** **`https://blockrun.ai/api/v1/chat/completions`** (OpenAI-compatible). The seller uses **`CLAWROUTER_MODEL`** (e.g. `claude-haiku-4.5`); avoid bare **`blockrun/auto`** on the public HTTP API unless you know it is supported.
- **Payments:** On **HTTP 402**, `packages/seller/src/clawrouter.ts` signs **EIP-712** USDC **`TransferWithAuthorization`** with **`SELLER_PRIVATE_KEY`** and retries with **`x-payment`** / **`payment-signature`** headers—same structure as [ClawRouter’s `x402.ts`](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts). **Fund the `SELLER_PRIVATE_KEY` address on Base mainnet with USDC**; failures surface as tool errors (no mock fallback).
- **ClawRouter** ([repo](https://github.com/edgeandnode/ClawRouter)) is the reference router; this repo embeds the payment + fetch logic needed for BlockRun’s gateway.

---

## What this demonstrates

| Use case | Location | Notes |
|----------|----------|--------|
| Seller (paid tools) | `packages/seller` | FastMCP + `withX402Payment` |
| LLM (BlockRun) | `packages/seller/clawrouter.ts` | x402 fetch; EIP-712 compatible with BlockRun |
| Naive buyer | `packages/buyer/naive-buyer.ts` | `createAgentCoreWallet` + NaiveTreasurer |
| MCP buyer | `packages/buyer/mcp-buyer.ts` | Same default; optional `AMPERSEND_SPEND_LIMIT_TREASURER` + smart-account env → Ampersend API treasurer (not CDP signing) |
| HTTP x402 | `packages/buyer/http-buyer.ts` | `@x402/fetch` + Ampersend |
| MCP proxy | `packages/buyer/proxy.ts` | Forwards MCP; wallet runs in this process |
| Bedrock AgentCore | `app/AgentBuyer/agent.ts` | Imports `@poc/buyer/agentcore-wallet` |
| Dashboard | `packages/web` | Next.js; `/api/invoke` uses AgentCore wallet unless pattern is **proxy** (see below) |

---

## Prerequisites

- **Node.js 20+** and **pnpm** (see root `packageManager` in `package.json`)
- **Coinbase Developer Platform** ([portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)) if you use **CDP mode** (three secrets below)
- **USDC**
  - On **Base Sepolia** for tool buyers when `CHAIN_NETWORK=base-sepolia`
  - On **Base mainnet** for the **seller LLM payer** (address from `SELLER_PRIVATE_KEY`)
- **Docker** — optional; required to build the AgentBuyer image (see [AgentCore container & deployment](#agentcore-container--deployment))

---

## Environment variables

Copy **`.env.example`** → **`.env`** at the **repository root** (scripts load it from there). See **[Focus: the four products](#focus-the-four-products)** for which addresses need USDC (buyer vs `SELLER_PRIVATE_KEY` vs `SELLER_WALLET_ADDRESS`).

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
| `SELLER_URL` | Optional | Seller MCP URL (defaults to `http://localhost:8000/mcp`; set for AgentCore in cloud) |
| `PROXY_URL` | Optional | MCP proxy URL for dashboard **proxy** pattern (default `http://localhost:8402/mcp`) |
| `AMPERSEND_SPEND_LIMIT_TREASURER` | Optional | Set to `1` in **`pnpm buyer:mcp` only** to use `createAmpersendTreasurer` (requires `BUYER_SMART_ACCOUNT_ADDRESS` + `BUYER_SESSION_KEY_PRIVATE_KEY`). Omit for AgentCore NaiveTreasurer. |

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
pnpm web:dev       # optional — http://localhost:3000 (runs `pnpm --filter @poc/buyer build` first)
```

**Dashboard tool invocations (`pnpm web:dev`):** Patterns **naive** and **ampersend** call `POST /api/invoke`, which uses **`createAgentCoreWallet()`** and **`createNaiveTreasurer()`** in the Next.js server (same x402 path as `pnpm buyer:naive`). Pattern **proxy** forwards MCP to `PROXY_URL` (default port **8402**); run **`pnpm buyer:proxy`** in another terminal and configure CDP / `BUYER_PRIVATE_KEY` on **that** process.

---

## Scripts (root)

| Script | Description |
|--------|-------------|
| `pnpm seller:dev` | FastMCP seller with ClawRouter/BlockRun backend |
| `pnpm buyer:naive` | MCP buyer: `createAgentCoreWallet` + NaiveTreasurer |
| `pnpm buyer:mcp` | Same default; opt-in spend-limit treasurer via `AMPERSEND_SPEND_LIMIT_TREASURER=1` + smart-account env |
| `pnpm buyer:http` | HTTP x402 sample |
| `pnpm buyer:proxy` | MCP proxy (wallet env applies here when using dashboard **proxy** pattern) |
| `pnpm web:dev` | Next.js app (`predev` compiles `@poc/buyer` to `dist/`) |
| `pnpm build` | `pnpm -r build` — seller, buyer (`tsc` → `dist/`), web (`next build`), `app/AgentBuyer` (`tsc`) |

---

## AgentCore wallet (CDP + Ampersend)

Implementation: `packages/buyer/src/agentcore-wallet.ts` + `packages/buyer/src/cdp-viem-account.ts`.

[Coinbase AgentKit](https://github.com/coinbase/agentkit) **`CdpEvmWalletProvider`** performs server-side signing. The code wraps it with **viem `toAccount()`** so **`AccountWallet`** can use **`x402`’s `createPaymentHeader`** (EIP-3009 style payments used by Ampersend).

**Consuming from another workspace package** (recommended):

```typescript
import { createAgentCoreWallet } from "@poc/buyer/agentcore-wallet";

const wallet = await createAgentCoreWallet();
console.log(wallet.getAddress(), wallet.getMode()); // "cdp" | "local"
wallet.getCdpProvider(); // CdpEvmWalletProvider | null

const treasurer = wallet.createNaiveTreasurer();
```

Inside `packages/buyer` source, TypeScript uses extensioned relative imports (e.g. `./agentcore-wallet.js`) per `moduleResolution: "NodeNext"`.

**Package export:** `@poc/buyer/agentcore-wallet` resolves to **compiled** `packages/buyer/dist/agentcore-wallet.js` (see `packages/buyer/package.json` `"exports"`). Run **`pnpm --filter @poc/buyer build`** before building dependents (`@poc/web`, `agent-buyer`). The web app’s **`build`** and **`predev`** scripts run that automatically.

Production: load CDP secrets from **AWS Secrets Manager** (or AgentCore-injected env), never commit `.env`.

---

## AgentCore container & deployment

- **`app/AgentBuyer`** depends on **`@poc/buyer`** — run **`pnpm --filter @poc/buyer build`** so `dist/` exists for the **`agentcore-wallet`** export before building the agent package or Docker image.
- **`SELLER_URL`** must be a **public** seller MCP URL in AWS; `http://localhost:8000/mcp` only works locally.

**Docker** (from **repository root**):

```bash
docker build -f app/AgentBuyer/Dockerfile .
```

The Dockerfile uses **`pnpm --filter agent-buyer deploy --legacy`** for pruned `node_modules` and `dist/`. **`agentcore/agentcore.json`** entries like **`PYTHON_3_12` / `main.py`** are **placeholders** for tooling; the container **`CMD`** runs the **Node** agent ([TypeScript runtime guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html)).

---

## Testing on Base mainnet

This uses **real USDC on Base** for tool payments and for BlockRun. Double-check addresses before sending funds.

1. In **`.env`** at the repo root, set **`CHAIN_NETWORK=base`** (not `base-sepolia`). Restart any running seller/buyer processes after changing it.
2. **CDP:** With all three `CDP_*` secrets set, `cdp-viem-account.ts` passes **`networkId`** from `CHAIN_NETWORK`, so the CDP wallet must be funded with **Base mainnet USDC** (USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base).
3. **`BUYER_PRIVATE_KEY`:** Fund that EOA with **Base mainnet USDC** (same contract). It pays the seller’s **`SELLER_WALLET_ADDRESS`** per tool prices (e.g. $0.01 per `research_topic`).
4. **`SELLER_WALLET_ADDRESS`:** Your receiving address for buyer tool payments on Base mainnet.
5. **`SELLER_PRIVATE_KEY`:** The derived address pays **BlockRun** via x402; keep it funded with **Base mainnet USDC** for LLM calls (independent of buyer↔seller amounts).
6. Run the same flow as [Quick start](#quick-start): **`pnpm seller:dev`**, then **`pnpm buyer:naive`** (or **`pnpm web:dev`**).

If anything still references Sepolia, ensure no stale **`CHAIN_NETWORK`** in the shell and that only one **`.env`** is loaded (repo root).

---

## Testing & troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Tool errors mentioning **ClawRouter** / **BlockRun** / HTTP status | BlockRun request failed: fund **mainnet USDC** on the address from **`SELLER_PRIVATE_KEY`**, check **`CLAWROUTER_MODEL`**, or inspect seller logs |
| `PAYMENT_INVALID` / verification errors (seller→BlockRun) | Wrong chain funding, or insufficient USDC on the **signing** address |
| Buyer payments fail on Sepolia | Fund the **buyer** wallet with **Sepolia** USDC when `CHAIN_NETWORK=base-sepolia` |
| Buyer payments fail on mainnet | Set **`CHAIN_NETWORK=base`** and fund the **buyer** with **Base mainnet** USDC (not Sepolia) |
| CDP mode not used | All three of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` must be set; remove `BUYER_PRIVATE_KEY` if you only want CDP |
| Dashboard **proxy** invocations fail (402 / connection) | Run **`pnpm buyer:proxy`** and ensure `PROXY_URL` / `SELLER_URL` match; wallet env applies to the **proxy** process, not only Next.js |
| `pnpm --filter @poc/web build` errors on `@poc/buyer` | Run **`pnpm --filter @poc/buyer build`** so `dist/` exists; the web **`build`** script does this automatically |

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
│       └── src/app/api/invoke/route.ts  # MCP invoke (AgentCore wallet unless proxy pattern)
├── app/AgentBuyer/            # BedrockAgentCoreApp + @poc/buyer
├── agentcore/                 # AgentCore CLI metadata
├── .env.example
└── README.md
```

---

## Technologies

**Core integrations (this POC):**

- [Amazon Bedrock](https://docs.aws.amazon.com/bedrock/) — foundation models; paired with AgentCore in `agentcore.json`
- [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/) — agent runtime; [`bedrock-agentcore`](https://www.npmjs.com/package/bedrock-agentcore) Node SDK
- [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk) — x402 on MCP/HTTP (`withX402Payment`, `AccountWallet`, treasurers)
- [BlockRun](https://blockrun.ai/) — paid LLM API (`blockrun.ai/api`); [ClawRouter](https://github.com/edgeandnode/ClawRouter) — reference x402 + routing patterns

**Also used:** [x402](https://github.com/coinbase/x402), [Coinbase CDP](https://docs.cdp.coinbase.com/) + [AgentKit](https://docs.cdp.coinbase.com/agent-kit/docs/welcome), [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com), [viem](https://viem.sh)

---

## License

Add a `LICENSE` file at the repository root if you distribute this project; this README does not specify a SPDX id by default.
