/**
 * AgentCore Wallet Provider
 *
 * Production path: Coinbase CDP via AgentKit `CdpEvmWalletProvider` — real server
 * wallet signing for x402 (EIP-712 / EIP-3009) through Ampersend `AccountWallet`.
 *
 * Fallback: local EOA private key (`BUYER_PRIVATE_KEY`) for dev without CDP.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";
import type { CdpEvmWalletProvider } from "@coinbase/agentkit";
import {
  AccountWallet,
  type X402Treasurer,
  type Authorization,
  type PaymentContext,
  type PaymentStatus,
} from "@ampersend_ai/ampersend-sdk/x402";
import { createCdpViemAccount } from "./cdp-viem-account.js";

// ---------------------------------------------------------------------------
// AgentCore wallet config
// ---------------------------------------------------------------------------

export interface AgentCoreWalletConfig {
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  cdpWalletSecret?: string;
  /** Optional: use an existing CDP EVM account address */
  cdpWalletAddress?: Hex;
  networkId?: string;
  privateKey?: Hex;
}

// ---------------------------------------------------------------------------
// Wallet provider
// ---------------------------------------------------------------------------

export class AgentCoreWalletProvider {
  private account: LocalAccount;
  private wallet: InstanceType<typeof AccountWallet>;
  private mode: "cdp" | "local";
  private cdpProvider: CdpEvmWalletProvider | null;

  private constructor(
    account: LocalAccount,
    wallet: InstanceType<typeof AccountWallet>,
    mode: "cdp" | "local",
    cdpProvider: CdpEvmWalletProvider | null = null,
  ) {
    this.account = account;
    this.wallet = wallet;
    this.mode = mode;
    this.cdpProvider = cdpProvider;
  }

  /**
   * Priority:
   * 1. CDP — CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET (real AgentKit wallet)
   * 2. BUYER_PRIVATE_KEY — local EOA
   * 3. Ephemeral unfunded wallet (demo only)
   */
  static async create(
    config?: AgentCoreWalletConfig,
  ): Promise<AgentCoreWalletProvider> {
    const cdpKeyId =
      config?.cdpApiKeyId ?? process.env.CDP_API_KEY_ID;
    const cdpKeySecret =
      config?.cdpApiKeySecret ?? process.env.CDP_API_KEY_SECRET;
    const cdpWalletSecret =
      config?.cdpWalletSecret ?? process.env.CDP_WALLET_SECRET;
    const rawKey =
      config?.privateKey ?? (process.env.BUYER_PRIVATE_KEY as Hex | undefined);

    const hasFullCdp =
      Boolean(cdpKeyId?.trim()) &&
      Boolean(cdpKeySecret?.trim()) &&
      Boolean(cdpWalletSecret?.trim());

    if (hasFullCdp) {
      console.log(
        "[agentcore-wallet] Using Coinbase CDP (AgentKit CdpEvmWalletProvider)",
      );
      const { account, cdp } = await createCdpViemAccount();
      const wallet = new AccountWallet(account);
      return new AgentCoreWalletProvider(account, wallet, "cdp", cdp);
    }

    if (rawKey) {
      console.log("[agentcore-wallet] Using local private key (BUYER_PRIVATE_KEY)");
      const account = privateKeyToAccount(rawKey);
      const wallet = new AccountWallet(account);
      return new AgentCoreWalletProvider(account, wallet, "local", null);
    }

    console.warn(
      "[agentcore-wallet] No CDP or BUYER_PRIVATE_KEY — ephemeral wallet (unfunded)",
    );
    const ephemeralKey = generatePrivateKey();
    const account = privateKeyToAccount(ephemeralKey);
    const wallet = new AccountWallet(account);
    return new AgentCoreWalletProvider(account, wallet, "local", null);
  }

  /** Set when mode is CDP — for advanced diagnostics or CDP API calls */
  getCdpProvider(): CdpEvmWalletProvider | null {
    return this.cdpProvider;
  }

  getWallet(): InstanceType<typeof AccountWallet> {
    return this.wallet;
  }

  getAddress(): Hex {
    return this.account.address;
  }

  getMode(): "cdp" | "local" {
    return this.mode;
  }

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

export async function createAgentCoreWallet(): Promise<AgentCoreWalletProvider> {
  return AgentCoreWalletProvider.create();
}
