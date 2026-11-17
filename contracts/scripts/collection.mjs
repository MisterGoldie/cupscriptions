import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, concatHex } from "viem";

export function collectionLeaf(id) {
  return keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }], [id])));
}

export function hashPair(a, b) {
  return keccak256(concatHex(a < b ? [a, b] : [b, a]));
}

export function buildCollection() {
  const raw = fs.readFileSync(new URL("../../src/data/cupscriptions.json", import.meta.url));
  const metadata = JSON.parse(raw);
  const ids = new Set();
  const numbers = new Set();
  const entries = metadata.collection_items.map((cup) => {
    const match = /^Cupscription #(\d+)$/.exec(cup.name);
    const id = cup.ethscription_id.toLowerCase();
    const number = Number(match?.[1]);
    if (!match || number < 1 || number > 5000 || numbers.has(number) ||
        !/^0x[0-9a-f]{64}$/.test(id) || ids.has(id)) {
      throw new Error("Invalid or duplicate Cupscriptions metadata entry");
    }
    ids.add(id);
    numbers.add(number);
    return { number, id, leaf: collectionLeaf(id) };
  }).sort((a, b) => a.leaf < b.leaf ? -1 : a.leaf > b.leaf ? 1 : 0);
  if (entries.length !== 5000) throw new Error("Expected exactly 5,000 cups");

  const layers = [entries.map((entry) => entry.leaf)];
  while (layers.at(-1).length > 1) {
    const current = layers.at(-1);
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }
    layers.push(next);
  }
  return {
    root: layers.at(-1)[0],
    count: entries.length,
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    entries,
    proofFor(id) {
      let index = entries.findIndex((entry) => entry.id === id.toLowerCase());
      if (index === -1) throw new Error("Inscription is not in Cupscriptions");
      const proof = [];
      for (const layer of layers.slice(0, -1)) {
        const sibling = index ^ 1;
        if (sibling < layer.length) proof.push(layer[sibling]);
        index = Math.floor(index / 2);
      }
      return proof;
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tree = buildCollection();
  const number = process.argv[2] ? Number(process.argv[2]) : null;
  const cup = number === null ? null : tree.entries.find((entry) => entry.number === number);
  if (number !== null && !cup) throw new Error("Cup number must be between 1 and 5000");
  console.log(JSON.stringify({
    root: tree.root, count: tree.count, sourceSha256: tree.sourceSha256,
    ...(cup ? { cup: cup.number, ethscriptionId: cup.id, proof: tree.proofFor(cup.id) } : {}),
  }, null, 2));
}
