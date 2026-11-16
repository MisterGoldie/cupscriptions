import collection from "@/data/cupscriptions.json";

export type CupTrait = {
  trait_type: string;
  value: string;
};

export type CupMeta = {
  id: number;
  name: string;
  ethscriptionId: string;
  attributes: CupTrait[];
};

type RawItem = {
  name: string;
  ethscription_id: string;
  item_attributes?: CupTrait[];
};

type RawCollection = {
  collection_items: RawItem[];
};

function displayIdFromName(name: string): number | null {
  const match = /^Cupscription #(\d+)$/.exec(name);
  if (!match) return null;
  return Number(match[1]);
}

const cupsById = new Map<number, CupMeta>();
const cupsByEthscriptionId = new Map<string, CupMeta>();

for (const item of (collection as RawCollection).collection_items) {
  const id = displayIdFromName(item.name);
  if (!id) continue;
  const cup = {
    id,
    name: item.name,
    ethscriptionId: item.ethscription_id,
    attributes: item.item_attributes ?? [],
  };
  cupsById.set(id, cup);
  cupsByEthscriptionId.set(cup.ethscriptionId.toLowerCase(), cup);
}

export function getCupMeta(id: number): CupMeta | undefined {
  return cupsById.get(id);
}

export function getCupMetaByEthscriptionId(id: string): CupMeta | undefined {
  return cupsByEthscriptionId.get(id.toLowerCase());
}

export function getTraitTypes(): string[] {
  const types = new Set<string>();
  for (const cup of cupsById.values()) {
    for (const attr of cup.attributes) types.add(attr.trait_type);
  }
  return [...types].sort((a, b) => a.localeCompare(b));
}
