/**
 * AgentCore Wallet Provider
 *
 * Follows the AWS Bedrock AgentCore x402 wallet pattern:
 *   - Coinbase Developer Platform (CDP) for wallet management
 *   - Wallet credentials stored externally (Secrets Manager in prod, env vars in POC)
 *   - Just-in-time credential retrieval
 *
 * Supports two modes:
 *   1. CDP mode: Uses @coinbase/coinbase-sdk for managed wallets
 *   2. Local mode: Uses a viem private key (for testing without CDP)
 *
 * Both modes produce an ampersend-sdk AccountWallet for x402 payment signing.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";
import {
  AccountWallet,
  type X402Treasurer,
  type Authorization,
  type PaymentContext,
  type PaymentStatus,
} from "@ampersend_ai/ampersend-sdk/x402";

// ---------------------------------------------------------------------------
// AgentCore wallet config
// ---------------------------------------------------------------------------

export interface AgentCoreWalletConfig {
  /** CDP API Key ID (from Coinbase Developer Platform) */
  cdpApiKeyId?: string;
  /** CDP API Key Secret */
  cdpApiKeySecret?: string;
  /** CDP Wallet Secret (for wallet recovery) */
  cdpWalletSecret?: string;
  /** Network ID (e.g. "base-sepolia") */
  networkId?: string;
  /** Fallback: raw private key for local/test mode */
  privateKey?: Hex;
}

// ---------------------------------------------------------------------------
// Wallet provider
// ---------------------------------------------------------------------------

export class AgentCoreWalletProvider {
  private account: LocalAccount;
  private wallet: InstanceType<typeof AccountWallet>;
  private mode: "cdp" | "local";

  private constructor(
    account: LocalAccount,
    wallet: InstanceType<typeof AccountWallet>,
    mode: "cdp" | "local",
  ) {
    this.account = account;
    this.wallet = wallet;
    this.mode = mode;
  }

  /**
   * Initialize the wallet provider from config or environment variables.
   *
   * Priority:
   * 1. CDP credentials (CDP_API_KEY_ID + CDP_API_KEY_SECRET) — production
   * 2. BUYER_PRIVATE_KEY — local testing
   * 3. Auto-generate ephemeral wallet — demo mode
   */
  static async create(
    config?: AgentCoreWalletConfig,
  ): Promise<AgentCoreWalletProvider> {
    const cdpKeyId =
      config?.cdpApiKeyId ?? process.env.CDP_API_KEY_ID;
    const cdpKeySecret =
      config?.cdpApiKeySecret ?? process.env.CDP_API_KEY_SECRET;
    const rawKey =
      config?.privateKey ?? (process.env.BUYER_PRIVATE_KEY as Hex | undefined);

    // Mode 1: CDP managed wallet
    if (cdpKeyId && cdpKeySecret) {
      console.log("[agentcore-wallet] Using CDP managed wallet");
      // In production, this would call the Coinbase SDK to retrieve or
      // create a wallet. The CDP API handles key management, signing
      // can be done server-side via the CDP Wallet API.
      //
      // For this POC we derive a deterministic key from the CDP credentials
      // to simulate the CDP wallet flow without requiring a live CDP account.
      const { keccak256, toBytes } = await import("viem");
      const seed = keccak256(
        toBytes(`${cdpKeyId}:${cdpKeySecret}`),
      );
      const account = privateKeyToAccount(seed);
      const wallet = new AccountWallet(account);
      return new AgentCoreWalletProvider(account, wallet, "cdp");
    }

    // Mode 2: Raw private key (local testing)
    if (rawKey) {
      console.log("[agentcore-wallet] Using local private key");
      const account = privateKeyToAccount(rawKey);
      const wallet = new AccountWallet(account);
      return new AgentCoreWalletProvider(account, wallet, "local");
    }

    // Mode 3: Auto-generate ephemeral wallet (demo)
    console.warn(
      "[agentcore-wallet] No credentials found — generating ephemeral wallet (unfunded)",
    );
    const ephemeralKey = generatePrivateKey();
    const account = privateKeyToAccount(ephemeralKey);
    const wallet = new AccountWallet(account);
    return new AgentCoreWalletProvider(account, wallet, "local");
  }

  /** Get the underlying ampersend-sdk AccountWallet */
  getWallet(): InstanceType<typeof AccountWallet> {
    return this.wallet;
  }

  /** Get the wallet address */
  getAddress(): Hex {
    return this.account.address;
  }

  /** Get the wallet mode */
  getMode(): "cdp" | "local" {
    return this.mode;
  }

  /**
   * Create a NaiveTreasurer that auto-approves all payments.
   * Uses the AgentCore wallet for signing.
   */
  createNaiveTreasurer(): X402Treasurer {
    const wallet = this.wallet;
    return {
      async onPaymentRequired(
        requirements: ReadonlyArray<any>,
        _context?: PaymentContext,
      ): Promise<Authorization | null> {
        if (requirements.length === 0) return null;
        const payment = await wallet.createPayment(requirements[0]);
        return { payment, authorizationId: crypto.randomUUID() };
      },
      async onStatus(
        status: PaymentStatus,
        authorization: Authorization,
      ): Promise<void> {
        console.log(
          `[agentcore-wallet] Payment ${authorization.authorizationId}: ${status}`,
        );
      },
    };
  }
}

/**
 * Quick helper: create wallet provider from environment variables.
 */
export async function createAgentCoreWallet(): Promise<AgentCoreWalletProvider> {
  return AgentCoreWalletProvider.create();
}
