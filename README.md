# AWS Bedrock AgentCore × Ampersend × BlockRun — Proof of Concept

TypeScript monorepo that connects **AWS Bedrock AgentCore** (optional deploy target), **Ampersend** x402 on **MCP** for paid tools, and **BlockRun** for LLM completions behind those tools. Two separate **x402** legs exist: **buyer → seller** (tool fees) and **seller → BlockRun** (LLM fees on Base mainnet).

---

## Contents

- [Architecture and data flow](#architecture-and-data-flow)
- [How each product fits](#how-each-product-fits)
- [Setup and testing](#setup-and-testing)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [AgentCore wallet (buyer)](#agentcore-wallet-buyer)
- [AgentCore deployment](#agentcore-deployment)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Technologies](#technologies)
- [License](#license)

---

## Architecture and data flow

End-to-end, a user-facing client pays for **MCP tool calls** with an **Ampersend**-backed wallet; the **seller** process then pays **BlockRun** for the actual model call. **Amazon Bedrock** appears in **AgentCore project metadata**; **LLM text in this POC comes from BlockRun**, not from Bedrock `Converse` APIs.

```mermaid
flowchart TB
  subgraph clients [Clients]
    NB[pnpm buyer:naive / web dashboard]
    AC[Bedrock AgentCore agent app/AgentBuyer]
  end

  subgraph leg1 [Leg 1 — Tool x402]
    W[AccountWallet + Treasurer]
    MCP[FastMCP seller :8000]
    FAC[Local x402Facilitator]
    PAYEE[SELLER_WALLET_ADDRESS]
  end

  subgraph leg2 [Leg 2 — LLM x402]
    CR[clawrouter.ts]
    BR[blockrun.ai API]
  end

  NB --> W
  AC --> W
  W -->|EIP-3009 signed auth| MCP
  MCP -->|verify + settle| FAC
  FAC -->|transferWithAuthorization| PAYEE
  MCP -->|invoke tool| CR
  CR -->|HTTP 402 + EIP-712 EOA| BR
```

| Step | What happens |
|------|----------------|
| 1 | Client uses **`createAgentCoreWallet()`** (CDP or `BUYER_PRIVATE_KEY` EOA) and a **treasurer** (`createNaiveTreasurer` or optional Ampersend API treasurer). |
| 2 | **MCP** connects to the **seller** (`withX402Payment`). The buyer signs an **EIP-3009 `transferWithAuthorization`** for **USDC** to **`SELLER_WALLET_ADDRESS`** (per `CHAIN_NETWORK`: Base Sepolia or Base mainnet). |
| 3 | The seller's **local `x402Facilitator`** (`@x402/evm ExactEvmSchemeV1`) **verifies** the buyer's signature on-chain, then **settles** by submitting `transferWithAuthorization` to the USDC contract. USDC moves from buyer to payee. The facilitator signer (`SELLER_PRIVATE_KEY`) pays gas (ETH). |
| 4 | Tool handlers call **`askClawRouter()`** in `packages/seller/src/clawrouter.ts`, which talks to **BlockRun** over HTTPS. |
| 5 | BlockRun returns **402 Payment Required**; the seller signs with a **separate funded EOA** ([ClawRouter-style](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts) **`signTypedData`**, x402 v2) using **`SELLER_BLOCKRUN_PRIVATE_KEY`** or **`SELLER_PRIVATE_KEY`**. BlockRun settles on **Base mainnet** USDC only for that leg. |

---

## How each product fits

### AWS AgentCore

- **Role:** Optional **runtime** for the TypeScript agent in `app/AgentBuyer` using [`bedrock-agentcore`](https://www.npmjs.com/package/bedrock-agentcore) (`BedrockAgentCoreApp`).
- **Config:** `agentcore/agentcore.json` registers **AgentCore Runtime**, **container** build, and **`modelProvider`**. The sample **maps prompts to MCP tool names** and calls the **seller MCP** (same wallet pattern as local buyers).
- **Networking:** For cloud runs, set **`SELLER_URL`** to a **public** seller MCP URL; `http://localhost:8000/mcp` is for local dev only.

### Amazon Bedrock

- **Role:** Declared as **`modelProvider`: `"Bedrock"`** in `agentcore.json` so deployments align with [Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/).
- **In this repo:** **`agent.ts` does not call Bedrock `Converse` (or other chat APIs)** for tool completions. Adding in-process Bedrock reasoning would be an extension; **tool text is produced by BlockRun** inside the seller.

### Ampersend

- **Role:** **x402** on **MCP** (and HTTP in other samples): **`withX402Payment`** on the server, **`AccountWallet` + treasurers** on clients.
- **In this repo:** Seller **`packages/seller`**, buyers **`packages/buyer`**, web **`packages/web`**. See [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk).

### BlockRun

- **Role:** Paid **OpenAI-compatible** API at `https://blockrun.ai/api` (e.g. `/v1/chat/completions`), gated by **x402**.
- **In this repo:** `packages/seller/src/clawrouter.ts` implements the same **EOA EIP-712** pattern as [ClawRouter `x402.ts`](https://github.com/edgeandnode/ClawRouter/blob/main/src/x402.ts). **Ampersend `SmartAccountWallet` / ERC-1271** payloads are **not** compatible with BlockRun's on-chain verifier—use a **funded EOA** for the BlockRun leg.

---

## Quick start

> **Prerequisites:** Node.js 20+ and pnpm. Docker only if you build the AgentBuyer container.

### 1. Clone and install

```bash
git clone https://github.com/kmjones1979/aws-agentcore-ampersend.git
cd aws-agentcore-ampersend
pnpm install
cp .env.example .env
```

### 2. Configure `.env`

Open `.env` and fill in these four values:

```bash
BUYER_PRIVATE_KEY=0x...          # EOA that pays for tool calls (needs USDC)
SELLER_WALLET_ADDRESS=0x...      # Address that receives tool USDC payments
SELLER_PRIVATE_KEY=0x...         # EOA that pays BlockRun + signs settlement (needs USDC + ETH)
CHAIN_NETWORK=base               # "base" for mainnet, "base-sepolia" for testnet
```

Optionally set `CLAWROUTER_MODEL` (defaults to `claude-haiku-4.5`).

### 3. Fund wallets

Three things need funding on the `CHAIN_NETWORK` chain:

| What | Token | Where |
|------|-------|-------|
| Buyer EOA (`BUYER_PRIVATE_KEY`) | **USDC** | Pays for tool calls (0.01–0.02 USDC each) |
| Seller EOA (`SELLER_PRIVATE_KEY`) | **ETH** | Gas for on-chain settlement (~0.0003 ETH is plenty) |
| Seller EOA (`SELLER_PRIVATE_KEY`) | **Base mainnet USDC** | Pays BlockRun for LLM calls |

A helper script sends gas ETH from the buyer to the seller EOA:

```bash
pnpm --filter @poc/buyer exec tsx ../../scripts/fund-facilitator.ts
```

### 4. Start the seller (Terminal 1)

```bash
pnpm seller:dev
```

You should see:

```
[seller] Local x402 facilitator ready (signer: 0x..., network: base)
[seller] FastMCP server listening on http://localhost:8000/mcp
[seller] Tools: research_topic, summarize_text, generate_code
```

### 5. Run the buyer (Terminal 2)

```bash
pnpm buyer:naive
```

Each tool call will:
1. Sign an EIP-3009 payment authorization
2. Verify and settle USDC on-chain to `SELLER_WALLET_ADDRESS`
3. Call BlockRun for the LLM response

**Success looks like:**

```
[agentcore-wallet] Payment ...: sending
[agentcore-wallet] Payment ...: accepted
```

Each result includes a real transaction hash:

```json
"_meta": {
  "x402/payment-response": {
    "success": true,
    "transaction": "0x2aa13a14...",
    "network": "base",
    "payer": "0x717520C8..."
  }
}
```

### 6. Verify on-chain

```bash
pnpm recent-txs
```

This prints BaseScan links for all env wallets. Or check the payee directly:

`https://basescan.org/address/<SELLER_WALLET_ADDRESS>#tokentxns`

### Optional: Web dashboard

```bash
pnpm web:dev       # http://localhost:3000
```

Uses the same wallet path as `pnpm buyer:naive`. The **proxy** pattern needs `pnpm buyer:proxy` running with a matching `PROXY_URL`.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` | Coinbase CDP / AgentKit (optional vs `BUYER_PRIVATE_KEY`) |
| `CDP_WALLET_ADDRESS` | Optional fixed CDP EVM address |
| `BUYER_PRIVATE_KEY` | Local EOA when not using full CDP |
| `SELLER_WALLET_ADDRESS` | Address that **receives** MCP tool x402 payments |
| `SELLER_PRIVATE_KEY` | **EOA** private key — used as the **local x402 facilitator signer** (needs ETH for gas on `CHAIN_NETWORK`) and as the **BlockRun payer** (needs Base mainnet USDC), unless `SELLER_BLOCKRUN_PRIVATE_KEY` is set |
| `SELLER_BLOCKRUN_PRIVATE_KEY` | Optional separate EOA **only** for BlockRun; if set, this key pays BlockRun and also serves as the facilitator signer |
| `CHAIN_NETWORK` | `base-sepolia` or `base` (buyer↔seller leg) |
| `CLAWROUTER_MODEL` | BlockRun model id (e.g. `claude-haiku-4.5`) |
| `SELLER_URL` | Seller MCP URL (default `http://localhost:8000/mcp`; set for AgentCore in AWS) |
| `PROXY_URL` | MCP proxy for dashboard proxy pattern (default port 8402) |
| `AMPERSEND_SPEND_LIMIT_TREASURER` | `1` only for `pnpm buyer:mcp` + smart-account env vars |

Copy **`.env.example`** as a template; never commit real secrets.

---

## Scripts

| Script | Description |
|--------|---------------|
| `pnpm seller:dev` | FastMCP seller + local x402 facilitator + BlockRun in tools |
| `pnpm buyer:naive` | MCP client: AgentCore wallet + NaiveTreasurer |
| `pnpm buyer:mcp` | MCP buyer with optional spend-limit treasurer |
| `pnpm buyer:http` | HTTP x402 sample |
| `pnpm buyer:proxy` | MCP proxy (for dashboard **proxy** pattern) |
| `pnpm web:dev` | Next.js dashboard |
| `pnpm recent-txs` | Recent tx links for env wallets |
| `pnpm build` | `pnpm -r build` across packages |

---

## AgentCore wallet (buyer)

Implementation: `packages/buyer/src/agentcore-wallet.ts`, CDP bridge: `cdp-viem-account.ts`. **`CdpEvmWalletProvider`** is wrapped with viem **`toAccount()`** so **`AccountWallet`** can sign x402.

**Import in other packages** (after `pnpm --filter @poc/buyer build`):

```typescript
import { createAgentCoreWallet } from "@poc/buyer/agentcore-wallet";
```

Production: load CDP secrets from **AWS Secrets Manager** or AgentCore env, not git.

---

## AgentCore deployment

- Build buyer first: **`pnpm --filter @poc/buyer build`** (web `predev`/`build` does this for the app).
- **Docker** from repo root: `docker build -f app/AgentBuyer/Dockerfile .`
- `agentcore/agentcore.json` may list **Python placeholders**; the container runs the **Node** agent. See [AgentCore TypeScript runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| MCP 402 / buyer payment fails | Wrong **`CHAIN_NETWORK`** or unfunded **buyer** USDC |
| **`PAYMENT_INVALID`** / ClawRouter 402 on tool result | **BlockRun EOA** has **no Base mainnet USDC**, or wrong model in **`CLAWROUTER_MODEL`** |
| `invalid_exact_evm_missing_eip712_domain` | Requirements missing `extra: { name, version }` — already set in `makeRequirements`; verify USDC EIP-712 domain matches |
| Settlement fails / facilitator out of gas | **`SELLER_PRIVATE_KEY`** EOA needs **ETH** on `CHAIN_NETWORK` for gas; run `scripts/fund-facilitator.ts` |
| `No facilitator configured` | Set **`SELLER_PRIVATE_KEY`** or **`SELLER_BLOCKRUN_PRIVATE_KEY`** in `.env` |
| Payments "accepted" but no on-chain USDC | Seller must show **`[seller] Local x402 facilitator ready`** at startup; if missing, the key is not set |
| BlockRun rejects "smart" signatures | BlockRun expects **ClawRouter EOA EIP-712**; fund the **EOA** from seller keys, not only a smart account |
| CDP not used | All three `CDP_*` vars set; remove stray **`BUYER_PRIVATE_KEY`** if you want CDP-only |
| Web build errors on `@poc/buyer` | Run **`pnpm --filter @poc/buyer build`** |

---

## Project structure

```
aws-agentcore-ampersend/
├── packages/
│   ├── seller/src/          # FastMCP, x402Facilitator, withX402Payment, clawrouter.ts → BlockRun
│   ├── buyer/src/           # AgentCore wallet, naive-buyer, mcp-buyer, proxy, http-buyer
│   └── web/                 # Next.js dashboard, /api/invoke
├── app/AgentBuyer/          # BedrockAgentCoreApp + @poc/buyer
├── agentcore/               # AgentCore CLI metadata
├── scripts/
│   ├── recent-tx-links.ts   # BaseScan links for env wallet addresses
│   └── fund-facilitator.ts  # Send gas ETH to the facilitator signer
├── .env.example
└── README.md
```

---

## Technologies

- [Amazon Bedrock](https://docs.aws.amazon.com/bedrock/) — foundation models; **`modelProvider`** in AgentCore config
- [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/) — runtime; [`bedrock-agentcore`](https://www.npmjs.com/package/bedrock-agentcore)
- [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk) — x402 MCP/HTTP
- [BlockRun](https://blockrun.ai/) — LLM API; [ClawRouter](https://github.com/edgeandnode/ClawRouter) — reference x402 client
- [x402](https://github.com/coinbase/x402) ([@x402/core](https://www.npmjs.com/package/@x402/core), [@x402/evm](https://www.npmjs.com/package/@x402/evm) — local facilitator), [Coinbase CDP](https://docs.cdp.coinbase.com/) + [AgentKit](https://docs.cdp.coinbase.com/agent-kit/docs/welcome), [Next.js](https://nextjs.org), [viem](https://viem.sh)

---

## License

Add a `LICENSE` file at the repository root if you distribute this project.
