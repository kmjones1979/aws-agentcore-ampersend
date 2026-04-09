import "dotenv/config";
import { z } from "zod";
import {
  withX402Payment,
  FastMCP,
} from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SELLER_PORT = Number(process.env.SELLER_PORT ?? 8000);
const SELLER_ADDRESS =
  process.env.SELLER_WALLET_ADDRESS ?? "0x0000000000000000000000000000000000000000";
const NETWORK = (process.env.CHAIN_NETWORK ?? "base-sepolia") as
  | "base-sepolia"
  | "base";

// USDC contract on Base Sepolia
const USDC_ASSET =
  NETWORK === "base-sepolia"
    ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ---------------------------------------------------------------------------
// Bedrock client (Claude)
// ---------------------------------------------------------------------------

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-west-2",
});

async function askClaude(prompt: string): Promise<string> {
  try {
    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const response = await bedrock.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    return body.content?.[0]?.text ?? "No response from model.";
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("[seller] Bedrock call failed, using mock response:", msg);
    return `[Mock response — Bedrock unavailable] Here is a simulated answer for: "${prompt}"`;
  }
}

// ---------------------------------------------------------------------------
// Payment helpers
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
  };
}

// ---------------------------------------------------------------------------
// FastMCP Server
// ---------------------------------------------------------------------------

const server = new FastMCP({ name: "ampersend-seller", version: "0.0.1" });

// Tool 1: Research a topic — $0.01 USDC (10000 micro-units, USDC has 6 decimals)
server.addTool({
  name: "research_topic",
  description:
    "Research a topic using AI. Returns a comprehensive overview. Costs 0.01 USDC per call.",
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
      console.log(
        `[seller] Payment received for research_topic — amount: ${requirements.maxAmountRequired}`,
      );
      return { success: true } as any;
    },
  })(async (args: { topic: string; depth: string }) => {
    const prompt =
      args.depth === "detailed"
        ? `Provide a detailed, multi-paragraph research overview of: ${args.topic}. Include key facts, history, and current developments.`
        : `Provide a brief research overview of: ${args.topic}. Keep it concise — 2-3 paragraphs.`;

    const result = await askClaude(prompt);
    return result;
  }),
});

// Tool 2: Summarize text — $0.005 USDC (5000 micro-units)
server.addTool({
  name: "summarize_text",
  description:
    "Summarize provided text using AI. Costs 0.005 USDC per call.",
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
      console.log(
        `[seller] Payment received for summarize_text — amount: ${requirements.maxAmountRequired}`,
      );
      return { success: true } as any;
    },
  })(async (args: { text: string; max_sentences: number }) => {
    const prompt = `Summarize the following text in at most ${args.max_sentences} sentences:\n\n${args.text}`;
    const result = await askClaude(prompt);
    return result;
  }),
});

// Tool 3: Generate code — $0.02 USDC (20000 micro-units)
server.addTool({
  name: "generate_code",
  description:
    "Generate code from a natural language description. Costs 0.02 USDC per call.",
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
      console.log(
        `[seller] Payment received for generate_code — amount: ${requirements.maxAmountRequired}`,
      );
      return { success: true } as any;
    },
  })(async (args: { description: string; language: string }) => {
    const prompt = `Generate ${args.language} code for the following:\n\n${args.description}\n\nReturn only the code with brief comments. No explanations outside the code.`;
    const result = await askClaude(prompt);
    return result;
  }),
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.start({
  transportType: "httpStream",
  httpStream: { port: SELLER_PORT },
});

console.log(`[seller] FastMCP server listening on http://localhost:${SELLER_PORT}/mcp`);
console.log(`[seller] Seller wallet: ${SELLER_ADDRESS}`);
console.log(`[seller] Network: ${NETWORK}`);
console.log(`[seller] Tools: research_topic, summarize_text, generate_code`);
