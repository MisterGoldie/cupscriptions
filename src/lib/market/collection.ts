import collection from "@/data/cupscriptions.json";
import { concatHex, encodeAbiParameters, keccak256, type Hex } from "viem";

let cached: { root: Hex; proofs: Map<string, Hex[]> } | undefined;

export function marketCollection() {
  if (cached) return cached;
  const ids = collection.collection_items.map((cup) => cup.ethscription_id.toLowerCase() as Hex);
  if (ids.length !== 5000 || new Set(ids).size !== 5000 || ids.some((id) => !/^0x[0-9a-f]{64}$/.test(id))) {
    throw new Error("Invalid market collection");
  }
  const entries = ids.map((id) => ({ id, leaf: keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }], [id]))) }))
    .sort((a, b) => a.leaf < b.leaf ? -1 : a.leaf > b.leaf ? 1 : 0);
  const layers: Hex[][] = [entries.map((entry) => entry.leaf)];
  while (layers.at(-1)!.length > 1) {
    const layer = layers.at(-1)!;
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i], b = layer[i + 1];
      next.push(b ? keccak256(concatHex(a < b ? [a, b] : [b, a])) : a);
    }
    layers.push(next);
  }
  const proofs = new Map<string, Hex[]>();
  entries.forEach((entry, initialIndex) => {
    let index = initialIndex;
    const proof: Hex[] = [];
    for (const layer of layers.slice(0, -1)) {
      const sibling = index ^ 1;
      if (sibling < layer.length) proof.push(layer[sibling]);
      index = Math.floor(index / 2);
    }
    proofs.set(entry.id, proof);
  });
  cached = { root: layers.at(-1)![0], proofs };
  return cached;
}
