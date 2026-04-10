/**
 * Bridge Coinbase CDP (AgentKit) server wallet → viem LocalAccount for Ampersend x402.
 *
 * `x402/client`'s `createPaymentHeader` expects a viem account with EIP-712 signing.
 * `CdpEvmWalletProvider` performs signing via CDP; we adapt it with `toAccount`.
 */

import { CdpEvmWalletProvider } from "@coinbase/agentkit";
import { toAccount } from "viem/accounts";
import type {
  Address,
  Hash,
  Hex,
  LocalAccount,
  SignableMessage,
  TransactionRequest,
} from "viem";
import type { TypedDataDefinition } from "viem";

function signableMessageToString(message: SignableMessage): string {
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && "raw" in message) {
    const raw = (message as { raw: Hex | Uint8Array | string }).raw;
    if (typeof raw === "string") return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw).toString("utf8");
    return raw;
  }
  return String(message);
}

export interface CdpViemAccountResult {
  account: LocalAccount;
  cdp: CdpEvmWalletProvider;
}

/**
 * Requires CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET (and optional CDP_WALLET_ADDRESS).
 */
export async function createCdpViemAccount(): Promise<CdpViemAccountResult> {
  const networkId =
    process.env.CHAIN_NETWORK ?? process.env.NETWORK_ID ?? "base-sepolia";
  const address = process.env.CDP_WALLET_ADDRESS as Address | undefined;

  const cdp = await CdpEvmWalletProvider.configureWithWallet({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
    networkId,
    ...(address ? { address } : {}),
  });

  const addr = cdp.getAddress() as Address;

  const account = toAccount({
    address: addr,
    sign: ({ hash }: { hash: Hash }) => cdp.sign(hash),
    signMessage: ({ message }: { message: SignableMessage }) =>
      cdp.signMessage(signableMessageToString(message)),
    signTransaction: (transaction, _options) =>
      cdp.signTransaction(transaction as unknown as TransactionRequest),
    signTypedData: <
      const typedData extends Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain",
    >(
      typedData: TypedDataDefinition<typedData, primaryType>,
    ) => cdp.signTypedData(typedData as unknown),
  });

  return { account: account as LocalAccount, cdp };
}
