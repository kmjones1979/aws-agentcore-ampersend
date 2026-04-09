# AgentCore + Ampersend SDK — Proof of Concept

TypeScript POC combining **AWS Bedrock AgentCore** (AI agent hosting) with the **Ampersend SDK** (x402 micropayment protocol) to demonstrate paid AI agent services with both buyer and seller roles.

## Architecture

```
  NextJS Dashboard (:3000)
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │             Buyer Patterns                   │
  │                                              │
  │  ┌──────────┐ ┌───────────┐ ┌────────────┐  │
  │  │  Naive    │ │ Ampersend │ │ MCP Proxy  │  │
  │  │ Treasurer │ │ Treasurer │ │   (:8402)  │  │
  │  │ (test)   │ │ (prod)    │ │            │  │
  │  └─────┬────┘ └─────┬─────┘ └──────┬─────┘  │
  │        │             │              │         │
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
  │                    ▼                          │
  │            AWS Bedrock (Claude)                │
  └───────────────────────────────────────────────┘

  AgentCore Runtime (optional deploy)
  ┌──────────────────────────────────────────────┐
  │  AgentBuyer — TypeScript container agent      │
  │  BedrockAgentCoreApp + Ampersend MCP client   │
  │  Calls seller tools autonomously              │
  └───────────────────────────────────────────────┘
```

## What This Demonstrates

| Use Case | Component | Ampersend SDK Feature |
|---|---|---|
| **Seller** — charge for AI tools | `packages/seller` | `withX402Payment` middleware on FastMCP |
| **Buyer (test)** — auto-approve payments | `packages/buyer/naive-buyer.ts` | `AccountWallet` + inline NaiveTreasurer |
| **Buyer (prod)** — spend-limited payments | `packages/buyer/mcp-buyer.ts` | `createAmpersendMcpClient` + `AmpersendTreasurer` |
| **Buyer (HTTP)** — paid HTTP API calls | `packages/buyer/http-buyer.ts` | `createAmpersendHttpClient` + `wrapFetchWithPayment` |
| **MCP Proxy** — transparent payment proxy | `packages/buyer/proxy.ts` | `createAmpersendProxy` |
| **AgentCore agent** — autonomous buyer | `app/AgentBuyer/agent.ts` | `BedrockAgentCoreApp` + Ampersend MCP client |
| **Dashboard** — visualize payment flows | `packages/web` | NextJS UI |

## Prerequisites

- **Node.js 20+** and **pnpm**
- **AWS credentials** configured (`aws configure`) with Bedrock model access (Claude Haiku)
- **Docker** (for AgentCore container deployment)
- **Private key** with test USDC on Base Sepolia ([Circle faucet](https://faucet.circle.com))
- **Ampersend account** (optional, for `AmpersendTreasurer` — run `npx @ampersend_ai/ampersend-sdk setup start`)

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your keys:
#   BUYER_PRIVATE_KEY=0x...          (for naive buyer)
#   SELLER_WALLET_ADDRESS=0x...      (address to receive payments)
#   AWS_REGION=us-west-2
```

### 3. Start the seller

```bash
pnpm seller:dev
# FastMCP server on http://localhost:8000/mcp
```

### 4. Run a buyer

In a separate terminal:

```bash
# Naive buyer (auto-approves all payments)
BUYER_PRIVATE_KEY=0x... pnpm buyer:naive

# Or Ampersend buyer (spend-limited, needs smart account)
BUYER_SMART_ACCOUNT_ADDRESS=0x... \
BUYER_SESSION_KEY_PRIVATE_KEY=0x... \
pnpm buyer:mcp
```

### 5. Start the dashboard

```bash
pnpm web:dev
# Open http://localhost:3000
```

### 6. (Optional) Start the MCP proxy

```bash
BUYER_SMART_ACCOUNT_ADDRESS=0x... \
BUYER_SESSION_KEY_PRIVATE_KEY=0x... \
pnpm buyer:proxy
# Proxy on http://localhost:8402
# Connect clients to: http://localhost:8402/mcp?target=http://localhost:8000/mcp
```

## AgentCore Deployment

The `app/AgentBuyer` directory contains a TypeScript agent that can be deployed to AWS Bedrock AgentCore Runtime.

### Local testing

```bash
# Install AgentCore CLI
npm install -g @aws/agentcore

# Test locally (requires Docker)
agentcore dev --runtime AgentBuyer
```

### Deploy to AWS

```bash
# Edit agentcore/aws-targets.json with your account ID and region
agentcore deploy

# Invoke the deployed agent
agentcore invoke "Research the x402 payment protocol"
```

## Project Structure

```
aws-agentcore-ampersend/
├── packages/
│   ├── seller/                     # FastMCP server with paid AI tools
│   │   └── src/index.ts            # 3 tools: research, summarize, generate
│   ├── buyer/                      # All buyer pattern demos
│   │   └── src/
│   │       ├── naive-buyer.ts      # NaiveTreasurer (auto-approve)
│   │       ├── mcp-buyer.ts        # AmpersendTreasurer (spend-limited)
│   │       ├── http-buyer.ts       # x402 HTTP fetch client
│   │       └── proxy.ts            # MCP payment proxy
│   └── web/                        # NextJS dashboard
│       └── src/app/
│           ├── page.tsx            # Main dashboard
│           ├── api/invoke/         # API route for tool invocation
│           └── components/         # UI components
├── app/
│   └── AgentBuyer/                 # AgentCore TypeScript agent
│       ├── agent.ts                # BedrockAgentCoreApp entrypoint
│       ├── Dockerfile
│       └── package.json
├── agentcore/                      # AgentCore CLI config
│   ├── agentcore.json
│   └── aws-targets.json
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .env.example
```

## Key Concepts

### x402 Payment Flow

1. **Client calls tool** → Seller returns HTTP 402 with payment requirements
2. **Treasurer authorizes** → Checks spend limits, creates signed payment
3. **Client retries with payment** → Seller verifies payment, executes tool
4. **Settlement** → Payment confirmed on-chain

### Treasurer Patterns

- **NaiveTreasurer**: Auto-approves everything. No spend limits. Testing only.
- **AmpersendTreasurer**: Calls Ampersend API to authorize within user-defined spending limits. Production pattern.

### Seller Middleware

The `withX402Payment` middleware wraps any FastMCP tool execute function:

```typescript
server.addTool({
  name: "my_tool",
  execute: withX402Payment({
    onExecute: async ({ args }) => {
      // Return payment requirements, or null if free
      return { scheme: "exact", maxAmountRequired: "10000", ... };
    },
    onPayment: async ({ payment, requirements }) => {
      // Verify and settle the payment
      return { success: true };
    },
  })(async (args) => {
    // Actual tool logic runs after payment
    return "result";
  }),
});
```

## Technologies

- [AWS Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/) — AI agent hosting and deployment
- [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk) — x402 payment protocol for agents
- [x402](https://github.com/coinbase/x402) — Transport-agnostic micropayment protocol
- [FastMCP](https://github.com/jlowin/fastmcp) — Model Context Protocol server framework
- [Next.js](https://nextjs.org) — React framework for the dashboard
- [Tailwind CSS](https://tailwindcss.com) — Styling

## License

Apache 2.0
