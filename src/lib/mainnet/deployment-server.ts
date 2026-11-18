import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createPublicClient, encodeDeployData, getAddress, http, keccak256, parseEther, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { marketAbi } from "@/lib/market/abi.generated";
import runtime from "@/lib/market/runtime.generated.json";
import { marketCollection } from "@/lib/market/collection";
import { createMarketIndexer } from "@/lib/market/indexer";
import { FEE_RECIPIENT, SALE_FEE } from "@/lib/market/types";
import { atomicJson } from "../../../scripts/sepolia/setup.mjs";
import { InvalidDeployment, verifyDeployment, type VerifiedDeployment } from "@/lib/sepolia/deployment-check";

const recordPath = () => path.join(process.cwd(), ".mainnet/deployment.json");
export const MAINNET_DEPLOYMENT_CONFIRMATIONS = 12;

export function mainnetClient() {
  const url = process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
  if (new URL(url).protocol !== "https:") throw new Error("Mainnet requires an HTTPS RPC");
  return createPublicClient({ chain: mainnet, transport: http(url, { timeout: 6000, retryCount: 0 }), cacheTime: 0 });
}

export async function mainnetDeploymentRecord(): Promise<VerifiedDeployment | null> {
  try { return JSON.parse(await fs.readFile(recordPath(), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Mainnet deployment record is unavailable"); }
}

export async function expectedMainnetDeployment() {
  const tree = marketCollection(1);
  if (tree.entries.length !== 5000 || tree.root !== runtime.collectionRoot) throw new Error("The original collection root could not be verified");
  const key = process.env.MAINNET_VERIFIER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Configure the mainnet verifier first");
  const verifier = privateKeyToAccount(key as Hex).address;
  const testKey = process.env.SEPOLIA_VERIFIER_PRIVATE_KEY;
  if (testKey && privateKeyToAccount(testKey as Hex).address === verifier) throw new Error("Use a separate mainnet verifier");
  const artifact = JSON.parse(await fs.readFile(path.join(process.cwd(), "contracts/artifacts/CupscriptionsMarket.json"), "utf8"));
  if (!/^0x[0-9a-f]+$/i.test(artifact.bytecode) || keccak256(artifact.bytecode) !== runtime.creationBytecodeHash) throw new Error("Rebuild the contract artifacts");
  const data = encodeDeployData({ abi: marketAbi, bytecode: artifact.bytecode as Hex, args: [tree.root, verifier] });
  return { root: tree.root, verifier, deployer: getAddress(FEE_RECIPIENT), data };
}

export async function getMainnetDeploymentPlan() {
  const expected = await expectedMainnetDeployment();
  const client = mainnetClient();
  if (await client.getChainId() !== 1) throw new Error("Wrong mainnet RPC");
  const [existing, head] = await Promise.all([mainnetDeploymentRecord(), client.getBlock()]);
  if (!head.number || Math.abs(Date.now() / 1000 - Number(head.timestamp)) > 120) throw new Error("Mainnet RPC head is stale");
  if (existing) await verifyDeployment(client, expected, existing.transactionHash, 1, MAINNET_DEPLOYMENT_CONFIRMATIONS);
  let indexerReady = false;
  try {
    const url = process.env.MAINNET_INDEXER_URL ?? "https://api.ethscriptions.com/v2";
    if (new URL(url).protocol !== "https:") throw new Error("HTTPS indexer required");
    // Deployment readiness tolerates ordinary indexing lag. Purchase signing
    // continues to require the full fresh RPC snapshot in market/service.ts.
    await createMarketIndexer(url, fetch, 1).assertFresh(head.number > 2n ? head.number - 2n : head.number);
    indexerReady = true;
  } catch { /* Keep the reviewable plan visible with deployment unavailable. */ }
  const [balance, gas, fees] = await Promise.all([
    client.getBalance({ address: expected.deployer }),
    existing ? Promise.resolve(0n) : client.estimateGas({ account: expected.deployer, data: expected.data, value: 0n,
      stateOverride: [{ address: expected.deployer, balance: parseEther("1") }] }),
    client.estimateFeesPerGas(),
  ]);
  const gasLimit = gas * 120n / 100n;
  const estimatedFee = gasLimit * fees.maxFeePerGas;
  return { chainId: 1 as const, ...expected, dataHash: keccak256(expected.data), feeRecipient: FEE_RECIPIENT, feeWei: SALE_FEE.toString(),
    collectionSize: 5000, requiredConfirmations: MAINNET_DEPLOYMENT_CONFIRMATIONS, indexerReady, gasLimit: gasLimit.toString(),
    estimatedFeeWei: estimatedFee.toString(), balanceWei: balance.toString(), fundingNeededWei: (estimatedFee > balance ? estimatedFee - balance : 0n).toString(), deployment: existing };
}

let registration: Promise<unknown> = Promise.resolve();
export function registerMainnetDeployment(hash: Hex) {
  const operation = registration.then(async () => {
    const expected = await expectedMainnetDeployment();
    const previous = await mainnetDeploymentRecord();
    if (previous && previous.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new InvalidDeployment("A different mainnet market is already configured");
    const verified = await verifyDeployment(mainnetClient(), expected, hash, 1, MAINNET_DEPLOYMENT_CONFIRMATIONS);
    await atomicJson(recordPath(), verified);
    return verified;
  });
  registration = operation.catch(() => {});
  return operation;
}
