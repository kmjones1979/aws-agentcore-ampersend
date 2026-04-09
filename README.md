# AgentCore + Ampersend SDK + ClawRouter — Proof of Concept

TypeScript POC combining **AWS Bedrock AgentCore** (agent hosting), **Ampersend SDK** (x402 payment protocol), and **ClawRouter** (smart LLM routing) to demonstrate paid AI agent services with both buyer and seller roles.

> **Branch `blockrun-ampersend`**: Uses [ClawRouter](https://github.com/edgeandnode/ClawRouter) as the LLM backend (with ampersend-sdk x402 in front) and the [AgentCore wallet pattern](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments) (Coinbase CDP) for buyer-side payment signing.

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
  │                    │ x402 payment (ampersend)  │
  │                    ▼                          │
  │       ClawRouter (blockrun.ai/api)            │
  │       41+ LLM models, smart routing           │
  └───────────────────────────────────────────────┘
```

The seller is **both a seller and a buyer**:
- Sells AI tools to clients via x402 (FastMCP middleware)
- Buys LLM inference from ClawRouter via x402 (ampersend HTTP client)

## What This Demonstrates

| Use Case | Component | Key Feature |
|---|---|---|
| **Seller** — charge for AI tools | `packages/seller` | `withX402Payment` + ClawRouter LLM backend |
| **LLM payment** — pay-per-request AI | `packages/seller/clawrouter.ts` | ampersend-sdk x402 HTTP client → BlockRun API |
| **Buyer (test)** — auto-approve | `packages/buyer/naive-buyer.ts` | AgentCore wallet + NaiveTreasurer |
| **Buyer (prod)** — spend-limited | `packages/buyer/mcp-buyer.ts` | AgentCore wallet + AmpersendTreasurer |
| **HTTP buyer** — paid HTTP calls | `packages/buyer/http-buyer.ts` | AgentCore wallet + x402 fetch |
| **MCP Proxy** — transparent proxy | `packages/buyer/proxy.ts` | AgentCore wallet + payment proxy |
| **AgentCore agent** — autonomous buyer | `app/AgentBuyer/agent.ts` | BedrockAgentCoreApp + AgentCore wallet |
| **Dashboard** — visualize flows | `packages/web` | NextJS UI |

## Key Changes (vs `main` branch)

1. **ClawRouter replaces Bedrock** — The seller calls `blockrun.ai/api/v1/chat/completions` (OpenAI-compatible) instead of AWS Bedrock directly. ampersend-sdk wraps these calls with x402 payment handling, so the seller pays per-LLM-request via USDC.

2. **AgentCore Wallet** — All buyer-side x402 payments use the Coinbase CDP wallet pattern (from the [AWS AgentCore x402 sample](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments)). Wallet credentials come from CDP API keys (production) or a raw private key (testing).

## Prerequisites

- **Node.js 20+** and **pnpm**
- **Coinbase Developer Platform** account ([portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)) for CDP wallet credentials
- **USDC on Base Sepolia** ([Circle faucet](https://faucet.circle.com)) — fund both buyer and seller wallets
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
# Option A: CDP wallet (production)
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-key-secret

# Option B: Raw private key (testing)
BUYER_PRIVATE_KEY=0x...

# Seller config
SELLER_WALLET_ADDRESS=0x...    # receives payment from buyers
SELLER_PRIVATE_KEY=0x...       # pays ClawRouter for LLM calls

# ClawRouter model (optional)
CLAWROUTER_MODEL=blockrun/auto  # auto | eco | premium | free
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

The `AgentCoreWalletProvider` (`packages/buyer/src/agentcore-wallet.ts`) follows the AWS sample pattern:

```typescript
import { createAgentCoreWallet } from "./agentcore-wallet.js";

// Automatically resolves credentials:
// 1. CDP_API_KEY_ID + CDP_API_KEY_SECRET → CDP managed wallet
// 2. BUYER_PRIVATE_KEY → local testing wallet
// 3. Neither → ephemeral wallet (unfunded)
const wallet = await createAgentCoreWallet();

// Get address and treasurer
console.log(wallet.getAddress());          // 0x...
console.log(wallet.getMode());             // "cdp" | "local"

const treasurer = wallet.createNaiveTreasurer();  // for x402 payments
```

In production, CDP credentials would be stored in **AWS Secrets Manager** and retrieved just-in-time by the AgentCore runtime.

## ClawRouter Integration

The seller uses ampersend-sdk as an x402 buyer of ClawRouter's LLM service:

```typescript
import { askClawRouter } from "./clawrouter.js";

// Calls blockrun.ai/api with automatic x402 payment
const response = await askClawRouter("Explain quantum computing");
```

ClawRouter routes each request to the cheapest capable model (41+ options across OpenAI, Anthropic, Google, DeepSeek, xAI, etc.) — paying per-request via USDC.

## Project Structure

```
aws-agentcore-ampersend/
├── packages/
│   ├── seller/
│   │   └── src/
│   │       ├── index.ts            # FastMCP server with paid tools
│   │       └── clawrouter.ts       # ClawRouter LLM client via ampersend x402
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
- [Coinbase CDP](https://docs.cdp.coinbase.com/) — Wallet management
- [Next.js](https://nextjs.org) + [Tailwind CSS](https://tailwindcss.com) — Dashboard

## License

Apache 2.0
