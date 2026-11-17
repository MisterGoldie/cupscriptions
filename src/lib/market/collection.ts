import collection from "@/data/cupscriptions.json";
import sepolia from "@/data/sepolia-cupscriptions.json";
import type { Hex } from "viem";
import { buildMarketTree } from "../../../shared/market-tree.mjs";

export type SepoliaItem = { number: number; ethscriptionId: Hex; creationBlock: string; creationBlockHash: Hex; contentUri: string };
export type SepoliaManifest = { version: number; chainId: number; name: string; initialOwner: string; items: SepoliaItem[] };
const cached = new Map<number, ReturnType<typeof buildCollectionProfile>>();

export function buildCollectionProfile(chainId: number, manifest: SepoliaManifest = sepolia as SepoliaManifest) {
  if (![1, 11155111, 31337].includes(chainId)) throw new Error("Unsupported marketplace network");
  const testnet = chainId === 11155111;
  const mainnetIds = new Set(collection.collection_items.map((cup) => cup.ethscription_id.toLowerCase()));
  if (testnet && (manifest.chainId !== 11155111 || manifest.version !== 1 || manifest.items.length !== 3 ||
      manifest.items.some((item) => mainnetIds.has(item.ethscriptionId.toLowerCase()) || ![1,2,3].includes(item.number)))) {
    throw new Error("Sepolia collection requires three separate confirmed test inscriptions");
  }
  const cups = testnet
    ? manifest.items.map((item) => ({ id: item.number, name: `Sepolia Test Cup #${item.number}`, ethscriptionId: item.ethscriptionId, attributes: [] }))
    : collection.collection_items.map((cup) => ({ id: Number(cup.name.match(/#(\d+)$/)?.[1]), name: cup.name, ethscriptionId: cup.ethscription_id as Hex, attributes: cup.item_attributes }));
  if (!testnet && (cups.length !== 5000 || cups.some((cup) => cup.id < 1 || cup.id > 5000))) throw new Error("Invalid mainnet collection");
  const tree = buildMarketTree(cups.map((cup) => ({ number: cup.id, id: cup.ethscriptionId as Hex })));
  return { ...tree, testnet, byId: new Map(cups.map((cup) => [cup.id, cup])), byHash: new Map(cups.map((cup) => [cup.ethscriptionId.toLowerCase(), cup])) };
}

export function marketCollection(chainId = 1) {
  if (![1, 11155111, 31337].includes(chainId)) throw new Error("Unsupported marketplace network");
  const key = chainId === 11155111 ? 11155111 : 1;
  if (!cached.has(key)) cached.set(key, buildCollectionProfile(key));
  return cached.get(key)!;
}
