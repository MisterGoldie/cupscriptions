import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { encodeDeployData, getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { marketAbi } from "@/lib/market/abi.generated";
import runtime from "@/lib/market/runtime.generated.json";
import { SALE_FEE, FEE_RECIPIENT } from "@/lib/market/types";
import { atomicJson, manifestTree, readManifest, testnetClient, verifyCreation } from "../../../scripts/sepolia/setup.mjs";
import { InvalidDeployment, verifyDeployment, type VerifiedDeployment } from "./deployment-check";

const recordPath = () => path.join(process.cwd(), ".sepolia/deployment.json");

export async function deploymentRecord(): Promise<VerifiedDeployment | null> {
  try { return JSON.parse(await fs.readFile(recordPath(), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Local deployment record is unavailable"); }
}

async function expectedDeployment() {
  const manifest = await readManifest();
  const tree = manifestTree(manifest);
  if (!tree) throw new Error("Confirm all three test cups first");
  const key = process.env.SEPOLIA_VERIFIER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("The Sepolia verifier is not configured");
  const verifier = privateKeyToAccount(key as Hex).address;
  const artifact = JSON.parse(await fs.readFile(path.join(process.cwd(), "contracts/artifacts/CupscriptionsMarket.json"), "utf8"));
  if (!/^0x[0-9a-f]+$/i.test(artifact.bytecode) || keccak256(artifact.bytecode) !== runtime.creationBytecodeHash) throw new Error("Rebuild the contract artifacts");
  const data = encodeDeployData({ abi: marketAbi, bytecode: artifact.bytecode as Hex, args: [tree.root, verifier] });
  return { root: tree.root, verifier, deployer: getAddress(manifest.initialOwner), data, manifest };
}

export async function getDeploymentPlan() {
  const expected = await expectedDeployment();
  const existing = await deploymentRecord();
  const client = testnetClient(undefined, { timeout: 5000, retryCount: 0 });
  if (await client.getChainId() !== 11155111) throw new Error("Wrong RPC network");
  if (existing) await verifyDeployment(client, expected, existing.transactionHash);
  const creationPlan = { owner: expected.manifest.initialOwner, items: expected.manifest.items };
  await Promise.all(expected.manifest.items.map((item: { number: number; ethscriptionId: Hex }) => verifyCreation(client, creationPlan, item.number, item.ethscriptionId)));
  const [balance, gas, fees] = await Promise.all([
    client.getBalance({ address: expected.deployer }),
    existing ? Promise.resolve(0n) : client.estimateGas({ account: expected.deployer, data: expected.data, value: 0n }),
    client.estimateFeesPerGas(),
  ]);
  const gasLimit = gas * 120n / 100n;
  return { chainId: 11155111 as const, deployer: expected.deployer, root: expected.root, verifier: expected.verifier,
    feeRecipient: FEE_RECIPIENT, feeWei: SALE_FEE.toString(), data: expected.data, dataHash: keccak256(expected.data),
    gasLimit: gasLimit.toString(), estimatedFeeWei: (gasLimit * fees.maxFeePerGas).toString(), balanceWei: balance.toString(), deployment: existing };
}

let registration: Promise<unknown> = Promise.resolve();
export function registerDeployment(hash: Hex) {
  const operation = registration.then(async () => {
    const expected = await expectedDeployment();
    const previous = await deploymentRecord();
    if (previous && previous.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new InvalidDeployment("A different marketplace is already configured");
    const verified = await verifyDeployment(testnetClient(), expected, hash);
    await atomicJson(recordPath(), verified);
    return verified;
  });
  registration = operation.catch(() => {});
  return operation;
}
