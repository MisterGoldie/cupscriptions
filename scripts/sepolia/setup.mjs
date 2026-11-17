import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, isAddress, stringToHex } from "viem";
import { sepolia } from "viem/chains";
import { buildMarketTree } from "../../shared/market-tree.mjs";

export const projectRoot = process.cwd();
export const stateDir = path.join(projectRoot, ".sepolia");
export const manifestPath = path.join(projectRoot, "src/data/sepolia-cupscriptions.json");
export const owner = "0xcbBcf40247425932d728585dA2678567e7F8E42f";
const planPath = path.join(stateDir, "plan.json");

export class CreationPendingError extends Error {
  constructor(confirmations = 0) {
    super("Creation is waiting for two confirmations");
    this.confirmations = confirmations;
  }
}

export class InvalidCreationError extends Error {}

export function testnetClient(url = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", { timeout = 12_000, retryCount = 1 } = {}) {
  return createPublicClient({ chain: sepolia, transport: http(url, { timeout, retryCount }), cacheTime: 0 });
}

export async function requireSepolia(client) {
  if (await client.getChainId() !== 11155111) throw new Error("Expected Ethereum Sepolia (11155111)");
}

export async function readManifest() {
  const data = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (data.chainId !== 11155111 || data.version !== 1 || !Array.isArray(data.items) || data.items.length > 3) throw new Error("Invalid Sepolia manifest");
  return data;
}

export async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomBytes(8).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await fs.rename(temporary, filename);
}

export async function preparePlan() {
  try {
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    if (plan.chainId !== 11155111 || plan.owner.toLowerCase() !== owner.toLowerCase() || plan.items.length !== 3) throw new Error("Invalid Sepolia plan");
    return plan;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = await readManifest();
  if (manifest.items.length === 3) {
    const plan = { version: 1, chainId: 11155111, batch: "imported", owner: manifest.initialOwner,
      items: manifest.items.map((item) => ({ number: item.number, contentUri: item.contentUri, transactionHash: item.ethscriptionId })) };
    await atomicJson(planPath, plan);
    return plan;
  }
  const batch = randomBytes(16).toString("hex");
  const items = [];
  for (let number = 1; number <= 3; number++) {
    const image = await fs.readFile(path.join(projectRoot, `public/sepolia/test-cup-${number}.svg`), "utf8");
    const content = `${image}\n<!-- Cupscriptions Sepolia batch ${batch}, cup ${number} -->`;
    items.push({ number, contentUri: `data:image/svg+xml;rule=esip6;base64,${Buffer.from(content).toString("base64")}`, transactionHash: null });
  }
  const plan = { version: 1, chainId: 11155111, batch, owner, items };
  await atomicJson(planPath, plan);
  return plan;
}

export async function verifyCreation(client, plan, number, hash) {
  await requireSepolia(client);
  const item = plan.items.find((entry) => entry.number === number);
  if (!item || !/^0x[0-9a-fA-F]{64}$/.test(hash) || !isAddress(plan.owner, { strict: false })) throw new InvalidCreationError("Invalid creation request");
  let tx, receipt, head;
  try {
    [tx, receipt, head] = await Promise.all([
      client.getTransaction({ hash }), client.getTransactionReceipt({ hash }), client.getBlockNumber({ cacheTime: 0 }),
    ]);
  } catch (error) {
    if (["TransactionNotFoundError", "TransactionReceiptNotFoundError"].includes(error.name)) throw new CreationPendingError();
    throw error;
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (receipt.status !== "success" || tx.hash.toLowerCase() !== hash.toLowerCase() || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      tx.from.toLowerCase() !== plan.owner.toLowerCase() ||
      tx.to?.toLowerCase() !== plan.owner.toLowerCase() || tx.value !== 0n || tx.input !== stringToHex(item.contentUri) ||
      tx.blockHash !== block.hash || receipt.blockHash !== block.hash || tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex) {
    throw new InvalidCreationError("Creation does not match the prepared cup and canonical successful receipt");
  }
  if (head < receipt.blockNumber + 1n) throw new CreationPendingError(Number(head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n));
  return { number, ethscriptionId: hash.toLowerCase(), creationBlock: receipt.blockNumber.toString(), creationBlockHash: receipt.blockHash, contentUri: item.contentUri };
}

let registration = Promise.resolve();
export function registerCreation(client, number, hash) {
  const operation = registration.then(async () => {
    const plan = await preparePlan();
    const item = plan.items.find((entry) => entry.number === number);
    if (!item || (item.transactionHash && item.transactionHash.toLowerCase() !== hash.toLowerCase())) throw new InvalidCreationError("This test cup already has a different creation transaction");
    await verifyCreation(client, plan, number, hash);
    item.transactionHash = hash.toLowerCase();
    await atomicJson(planPath, plan);
    if (plan.items.every((entry) => entry.transactionHash)) {
      const items = await Promise.all(plan.items.map((entry) => verifyCreation(client, plan, entry.number, entry.transactionHash)));
      const previous = await readManifest();
      if (previous.items.length && previous.items.some((entry) => !items.some((item) => item.number === entry.number && item.ethscriptionId === entry.ethscriptionId))) {
        throw new Error("Refusing to replace the existing Sepolia collection");
      }
      await atomicJson(manifestPath, { version: 1, chainId: 11155111, name: "Cupscriptions Sepolia Test", initialOwner: plan.owner, items });
    }
    return plan;
  });
  registration = operation.catch(() => {});
  return operation;
}

export function manifestTree(manifest) {
  if (manifest.chainId !== 11155111 || manifest.items.length !== 3) return null;
  return buildMarketTree(manifest.items.map((item) => ({ number: item.number, id: item.ethscriptionId })));
}
