import { concatHex, encodeAbiParameters, keccak256 } from "viem";

/** @param {{number: number, id: import('viem').Hex}[]} items */
export function buildMarketTree(items) {
  if (!items.length) throw new Error("Collection has no confirmed inscriptions");
  const entries = items.map((entry) => ({
    ...entry, id: /** @type {import('viem').Hex} */ (entry.id.toLowerCase()),
    leaf: keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }], [entry.id]))),
  })).sort((a, b) => a.leaf < b.leaf ? -1 : a.leaf > b.leaf ? 1 : 0);
  if (new Set(entries.map((item) => item.number)).size !== items.length ||
      new Set(entries.map((item) => item.id)).size !== items.length ||
      entries.some((item) => !Number.isSafeInteger(item.number) || item.number < 1 || !/^0x[0-9a-f]{64}$/.test(item.id))) {
    throw new Error("Invalid collection entries");
  }
  const layers = [entries.map((entry) => entry.leaf)];
  while (layers.at(-1).length > 1) {
    const layer = layers.at(-1), next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i], b = layer[i + 1];
      next.push(b ? keccak256(concatHex(a < b ? [a, b] : [b, a])) : a);
    }
    layers.push(next);
  }
  /** @type {Map<string, import('viem').Hex[]>} */
  const proofs = new Map();
  entries.forEach((entry, initial) => {
    let index = initial;
    const proof = [];
    for (const layer of layers.slice(0, -1)) {
      if ((index ^ 1) < layer.length) proof.push(layer[index ^ 1]);
      index = Math.floor(index / 2);
    }
    proofs.set(entry.id, proof);
  });
  return { root: layers.at(-1)[0], proofs, entries,
    /** @param {string} id */
    proofFor(id) {
      const proof = proofs.get(id.toLowerCase());
      if (!proof) throw new Error("Inscription is not in this collection");
      return proof;
    },
  };
}
