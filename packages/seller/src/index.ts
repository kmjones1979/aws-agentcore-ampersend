import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname, "../../../.env") });
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, publicActions, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  withX402Payment,
  FastMCP,
} from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { askClawRouter } from "./clawrouter.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SELLER_PORT = Number(process.env.SELLER_PORT ?? 8000);
const SELLER_ADDRESS =
  process.env.SELLER_WALLET_ADDRESS ?? "0x0000000000000000000000000000000000000000";
const NETWORK = (process.env.CHAIN_NETWORK ?? "base-sepolia") as
  | "base-sepolia"
  | "base";

const USDC_ASSET =
  NETWORK === "base-sepolia"
    ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const USDC_EIP712_NAME = NETWORK === "base-sepolia" ? "USDC" : "USD Coin";
const USDC_EIP712_VERSION = "2";

function logSellerAddressAudit(): void {
  const explorerBase =
    NETWORK === "base"
      ? "https://basescan.org/address/"
      : "https://sepolia.basescan.org/address/";
  console.log("[seller] ========== x402 address audit (public only; never log private keys) ==========");
  console.log(`[seller] Tool leg CHAIN_NETWORK: ${NETWORK}`);
  console.log(`[seller] Tool leg USDC contract: ${USDC_ASSET}`);
  console.log(`[seller] Tool payee (SELLER_WALLET_ADDRESS): ${SELLER_ADDRESS}`);
  const blockrunKey = (
    process.env.SELLER_BLOCKRUN_PRIVATE_KEY?.trim() ||
    process.env.SELLER_PRIVATE_KEY?.trim()
  ) as Hex | undefined;
  if (blockrunKey) {
    try {
      const blockrunPayer = privateKeyToAccount(blockrunKey).address;
      console.log(`[seller] BlockRun payer EOA (derived from seller BlockRun key): ${blockrunPayer}`);
      console.log(
        `[seller] BlockRun explorer (mainnet only): https://basescan.org/address/${blockrunPayer}#tokentxns`,
      );
    } catch {
      console.warn("[seller] Could not derive BlockRun payer from SELLER_* keys.");
    }
  } else {
    console.log("[seller] BlockRun payer: (set SELLER_PRIVATE_KEY or SELLER_BLOCKRUN_PRIVATE_KEY)");
  }
  console.log(
    `[seller] Tool payee — match this chain: ${explorerBase}${SELLER_ADDRESS}#tokentxns`,
  );
  console.log("[seller] ======================================================================");
}

// ---------------------------------------------------------------------------
// Local x402 facilitator — verifies + settles buyer payments on-chain
// ---------------------------------------------------------------------------

const FACILITATOR_KEY = (
  process.env.SELLER_BLOCKRUN_PRIVATE_KEY?.trim() ||
  process.env.SELLER_PRIVATE_KEY?.trim()
) as Hex | undefined;

let localFacilitator: InstanceType<typeof x402Facilitator> | null = null;

if (FACILITATOR_KEY) {
  const facAccount = privateKeyToAccount(FACILITATOR_KEY);
  const chain = NETWORK === "base" ? base : baseSepolia;
  const facClient = createWalletClient({
    account: facAccount,
    chain,
    transport: http(),
  }).extend(publicActions);

  const signer = toFacilitatorEvmSigner(facClient as any);
  localFacilitator = new x402Facilitator();
  localFacilitator.registerV1(NETWORK, new ExactEvmSchemeV1(signer));
  console.log(
    `[seller] Local x402 facilitator ready (signer: ${facAccount.address}, network: ${NETWORK})`,
  );
} else {
  console.warn(
    "[seller] No seller key set — cannot run local facilitator; tool payments will NOT settle on-chain",
  );
}

async function settlePayment(
  toolName: string,
  payment: unknown,
  requirements: Record<string, unknown>,
) {
  if (!localFacilitator) {
    throw new Error(
      "No facilitator configured — set SELLER_PRIVATE_KEY or SELLER_BLOCKRUN_PRIVATE_KEY",
    );
  }

  console.log(
    `[seller] ${toolName} — verifying payment (payTo: ${requirements.payTo}, amount: ${requirements.maxAmountRequired}, network: ${NETWORK})`,
  );

  const verifyResult = await localFacilitator.verify(
    payment as any,
    requirements as any,
  );
  if (!verifyResult.isValid) {
    const reason = (verifyResult as any).invalidReason ?? "unknown";
    console.error(
      `[seller] ${toolName} — payment verification failed: ${reason}`,
    );
    throw new Error(`Payment verification failed: ${reason}`);
  }
  console.log(`[seller] ${toolName} — payment verified, settling on-chain…`);

  const settleResult = await localFacilitator.settle(
    payment as any,
    requirements as any,
  );
  if (!settleResult.success) {
    const reason = (settleResult as any).errorReason ?? "unknown";
    console.error(`[seller] ${toolName} — settlement failed: ${reason}`);
    throw new Error(`Settlement failed: ${reason}`);
  }

  console.log(
    `[seller] ${toolName} — settled ✓ tx: ${settleResult.transaction ?? "(pending)"} network: ${settleResult.network ?? NETWORK}`,
  );
  return settleResult;
}

// ---------------------------------------------------------------------------
// Payment requirements builder
// ---------------------------------------------------------------------------

function makeRequirements(
  toolName: string,
  amountMicroUsdc: string,
  description: string,
) {
  return {
    scheme: "exact" as const,
    network: NETWORK,
    maxAmountRequired: amountMicroUsdc,
    resource: `tool://${toolName}`,
    description,
    mimeType: "application/json",
    payTo: SELLER_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: USDC_ASSET,
    extra: { name: USDC_EIP712_NAME, version: USDC_EIP712_VERSION },
  };
}

// ---------------------------------------------------------------------------
// FastMCP Server
// ---------------------------------------------------------------------------

const server = new FastMCP({ name: "ampersend-seller", version: "0.0.2" });

// Tool 1: Research a topic — $0.01 USDC
server.addTool({
  name: "research_topic",
  description:
    "Research a topic using AI (powered by ClawRouter). Costs 0.01 USDC per call.",
  parameters: z.object({
    topic: z.string().describe("The topic to research"),
    depth: z
      .enum(["brief", "detailed"])
      .default("brief")
      .describe("Level of detail"),
  }),
  execute: withX402Payment({
    onExecute: async ({ args }) => {
      return makeRequirements(
        "research_topic",
        "10000",
        "AI-powered topic research (0.01 USDC)",
      );
    },
    onPayment: async ({ payment, requirements }) => {
      return await settlePayment("research_topic", payment, requirements);
    },
  })(async (args: { topic: string; depth: string }) => {
    const prompt =
      args.depth === "detailed"
        ? `Provide a detailed, multi-paragraph research overview of: ${args.topic}. Include key facts, history, and current developments.`
        : `Provide a brief research overview of: ${args.topic}. Keep it concise — 2-3 paragraphs.`;

    return await askClawRouter(prompt);
  }),
});

// Tool 2: Summarize text — $0.005 USDC
server.addTool({
  name: "summarize_text",
  description:
    "Summarize provided text using AI (powered by ClawRouter). Costs 0.005 USDC per call.",
  parameters: z.object({
    text: z.string().describe("The text to summarize"),
    max_sentences: z
      .number()
      .default(3)
      .describe("Maximum sentences in the summary"),
  }),
  execute: withX402Payment({
    onExecute: async ({ args }) => {
      return makeRequirements(
        "summarize_text",
        "5000",
        "AI-powered text summarization (0.005 USDC)",
      );
    },
    onPayment: async ({ payment, requirements }) => {
      return await settlePayment("summarize_text", payment, requirements);
    },
  })(async (args: { text: string; max_sentences: number }) => {
    const prompt = `Summarize the following text in at most ${args.max_sentences} sentences:\n\n${args.text}`;
    return await askClawRouter(prompt);
  }),
});

// Tool 3: Generate code — $0.02 USDC
server.addTool({
  name: "generate_code",
  description:
    "Generate code from a natural language description (powered by ClawRouter). Costs 0.02 USDC per call.",
  parameters: z.object({
    description: z
      .string()
      .describe("Natural language description of the code to generate"),
    language: z
      .enum(["typescript", "python", "solidity", "rust"])
      .default("typescript")
      .describe("Programming language"),
  }),
  execute: withX402Payment({
    onExecute: async ({ args }) => {
      return makeRequirements(
        "generate_code",
        "20000",
        "AI-powered code generation (0.02 USDC)",
      );
    },
    onPayment: async ({ payment, requirements }) => {
      return await settlePayment("generate_code", payment, requirements);
    },
  })(async (args: { description: string; language: string }) => {
    const prompt = `Generate ${args.language} code for the following:\n\n${args.description}\n\nReturn only the code with brief comments. No explanations outside the code.`;
    return await askClawRouter(prompt);
  }),
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

logSellerAddressAudit();

server.start({
  transportType: "httpStream",
  httpStream: { port: SELLER_PORT },
});

const model = process.env.CLAWROUTER_MODEL ?? "blockrun/auto";
console.log(`[seller] FastMCP server listening on http://localhost:${SELLER_PORT}/mcp`);
console.log(`[seller] LLM backend: ClawRouter (${model}) via x402`);
console.log(`[seller] Seller wallet: ${SELLER_ADDRESS}`);
console.log(`[seller] Network: ${NETWORK}`);
console.log(`[seller] Tools: research_topic, summarize_text, generate_code`);
