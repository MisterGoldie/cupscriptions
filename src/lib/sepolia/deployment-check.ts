import { getAddress, hexToBytes, isAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { marketAbi } from "@/lib/market/abi.generated";
import runtime from "@/lib/market/runtime.generated.json";
import { FEE_RECIPIENT, SALE_FEE } from "@/lib/market/types";

export class DeploymentPending extends Error { constructor(public confirmations = 0, public requiredConfirmations = 2) { super("Deployment is not yet confirmed"); } }
export class InvalidDeployment extends Error {}
export type ExpectedDeployment = { root: Hex; verifier: Address; deployer: Address; data: Hex };
export type VerifiedDeployment = { chainId: 1 | 11155111; address: Address; transactionHash: Hex; blockNumber: string; blockHash: Hex; root: Hex; verifier: Address; deployer: Address };

export async function verifyDeployment(client: PublicClient, expected: ExpectedDeployment, hash: Hex, chainId: 1 | 11155111 = 11155111, confirmations = 2): Promise<VerifiedDeployment> {
  if (await client.getChainId() !== chainId) throw new InvalidDeployment("Wrong deployment network");
  let tx, receipt, head;
  try {
    [tx, receipt, head] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash }), client.getBlockNumber({ cacheTime: 0 })]);
  } catch (error) {
    if (["TransactionNotFoundError", "TransactionReceiptNotFoundError"].includes(error instanceof Error ? error.name : "")) throw new DeploymentPending(0, confirmations);
    throw error;
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
  if (receipt.status !== "success" || tx.chainId !== chainId || tx.to !== null || receipt.to !== null || tx.value !== 0n ||
      !same(tx.hash, hash) || !same(receipt.transactionHash, hash) || !same(tx.from, expected.deployer) || !same(receipt.from, expected.deployer) ||
      tx.input.toLowerCase() !== expected.data.toLowerCase() || tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex ||
      tx.blockHash !== block.hash || receipt.blockHash !== block.hash || !receipt.contractAddress || !isAddress(receipt.contractAddress)) {
    throw new InvalidDeployment("Transaction is not the reviewed deployment");
  }
  if (head < receipt.blockNumber + BigInt(confirmations - 1)) throw new DeploymentPending(Number(head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n), confirmations);
  const address = getAddress(receipt.contractAddress);
  const read = <T extends "collectionRoot" | "ownershipVerifier" | "MARKETPLACE_FEE" | "feeRecipient">(functionName: T) =>
    client.readContract({ address, abi: marketAbi, functionName, blockNumber: head });
  const [code, root, verifier, fee, recipient] = await Promise.all([
    client.getCode({ address, blockNumber: head }), read("collectionRoot"), read("ownershipVerifier"), read("MARKETPLACE_FEE"), read("feeRecipient"),
  ]);
  if (!code) throw new InvalidDeployment("Contract code is missing");
  const bytes = hexToBytes(code);
  for (const { start, length } of runtime.immutableReferences) bytes.fill(0, start, start + length);
  if (keccak256(bytes) !== runtime.runtimeHash || root !== expected.root || !same(verifier, expected.verifier) || fee !== SALE_FEE || !same(recipient, FEE_RECIPIENT)) {
    throw new InvalidDeployment("Deployed contract does not match the reviewed configuration");
  }
  if ((await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new InvalidDeployment("Deployment block changed");
  return { chainId, address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    root: expected.root, verifier: expected.verifier, deployer: expected.deployer };
}
