import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const pk = process.env.BUYER_PRIVATE_KEY as Hex | undefined;
if (!pk) {
  console.error("No BUYER_PRIVATE_KEY in .env");
  process.exit(1);
}

const facilitatorKey = (
  process.env.SELLER_BLOCKRUN_PRIVATE_KEY?.trim() ||
  process.env.SELLER_PRIVATE_KEY?.trim()
) as Hex | undefined;
if (!facilitatorKey) {
  console.error("No SELLER_PRIVATE_KEY or SELLER_BLOCKRUN_PRIVATE_KEY");
  process.exit(1);
}

const facilitatorAddress = privateKeyToAccount(facilitatorKey).address;
const account = privateKeyToAccount(pk);

const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

async function main() {
  const currentBal = await publicClient.getBalance({ address: facilitatorAddress });
  console.log(`Facilitator ${facilitatorAddress} current ETH: ${formatEther(currentBal)}`);

  if (currentBal > parseEther("0.0001")) {
    console.log("Already has enough gas — skipping.");
    process.exit(0);
  }

  const amount = parseEther("0.0003");
  console.log(`Sending ${formatEther(amount)} ETH from buyer ${account.address} → facilitator ${facilitatorAddress}`);

  const hash = await walletClient.sendTransaction({ to: facilitatorAddress, value: amount });
  console.log(`Tx: https://basescan.org/tx/${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed (status: ${receipt.status}). Facilitator should now have gas for settlement.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
