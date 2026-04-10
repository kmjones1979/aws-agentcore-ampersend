/**
 * After an x402 test run, lists recent on-chain transactions for env addresses
 * via Blockscout JSON API, with BaseScan links (settlement txs — not the EIP-712 UUID in stdout).
 *
 * Usage (from repo root): pnpm recent-txs
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve monorepo root `.env` whether `pnpm` runs from repo root or `packages/buyer`. */
function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
    resolve(process.cwd(), "..", "..", ".env"),
    resolve(__dirname, "..", ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      config({ path: p });
      return;
    }
  }
}

const BLOCKSCOUT: Record<string, string> = {
  base: "https://base.blockscout.com/api/v2",
  "base-sepolia": "https://base-sepolia.blockscout.com/api/v2",
};

const BASESCAN_TX: Record<string, string> = {
  base: "https://basescan.org/tx",
  "base-sepolia": "https://sepolia.basescan.org/tx",
};

async function fetchRecent(
  apiBase: string,
  address: string,
  limit: number,
): Promise<Array<{ hash: string; timestamp: string }>> {
  const url = `${apiBase}/addresses/${address}/transactions`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Blockscout ${res.status} for ${address}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: Array<{ hash: string; timestamp?: string }>;
  };
  const items = data.items ?? [];
  return items.slice(0, limit).map((t) => ({
    hash: t.hash,
    timestamp: t.timestamp ?? "",
  }));
}

async function main(): Promise<void> {
  loadRootEnv();
  const network = (process.env.CHAIN_NETWORK ?? "base-sepolia") as "base" | "base-sepolia";
  const api = BLOCKSCOUT[network];
  const explorer = BASESCAN_TX[network];
  if (!api || !explorer) {
    console.error(`Unsupported CHAIN_NETWORK for explorers: ${network}`);
    process.exit(1);
  }

  type Row = { label: string; address: string; apiBase: string; txBase: string };
  const rows: Row[] = [];

  const buyerPk = process.env.BUYER_PRIVATE_KEY as Hex | undefined;
  if (buyerPk) {
    rows.push({
      label: "Buyer (BUYER_PRIVATE_KEY)",
      address: privateKeyToAccount(buyerPk).address,
      apiBase: api,
      txBase: explorer,
    });
  }

  const sw = process.env.SELLER_WALLET_ADDRESS;
  if (sw?.startsWith("0x")) {
    rows.push({
      label: "SELLER_WALLET_ADDRESS (receives tool USDC)",
      address: sw,
      apiBase: api,
      txBase: explorer,
    });
  }

  const blockrunPk =
    (process.env.SELLER_BLOCKRUN_PRIVATE_KEY as Hex | undefined) ??
    (process.env.SELLER_PRIVATE_KEY as Hex | undefined);
  if (blockrunPk) {
    const mainApi = BLOCKSCOUT.base!;
    const mainTx = BASESCAN_TX.base!;
    const derived = privateKeyToAccount(blockrunPk).address;
    rows.push({
      label:
        "SELLER_BLOCKRUN_PRIVATE_KEY or SELLER_PRIVATE_KEY (BlockRun EOA payer — Base mainnet)",
      address: derived,
      apiBase: mainApi,
      txBase: mainTx,
    });
  }

  if (rows.length === 0) {
    console.log("No BUYER_PRIVATE_KEY / SELLER_* in .env — nothing to look up.");
    process.exit(0);
  }

  console.log(
    `\nRecent on-chain txs (tool leg uses CHAIN_NETWORK=${network}; BlockRun leg is mainnet) — newest first:\n`,
  );

  for (const { label, address, apiBase, txBase } of rows) {
    console.log(`--- ${label} ---`);
    console.log(`Address: ${address}`);
    try {
      const txs = await fetchRecent(apiBase, address, 8);
      if (txs.length === 0) {
        console.log("  (no transactions returned — fund the wallet or wait for settlement)\n");
        continue;
      }
      for (const t of txs) {
        console.log(`  ${txBase}/${t.hash}`);
        if (t.timestamp) console.log(`    time: ${t.timestamp}`);
      }
    } catch (e) {
      console.log(`  Error: ${e instanceof Error ? e.message : e}`);
    }
    console.log("");
  }

  console.log(
    "Note: x402 tool flows may settle asynchronously; if you do not see a new hash yet, refresh in a minute or search the address on BaseScan.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
