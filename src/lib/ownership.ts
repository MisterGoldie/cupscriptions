import { getCupMetaByEthscriptionId } from "@/lib/traits";

const ETHSCRIPTIONS_API = "https://api.ethscriptions.com/v2";

export type OwnedCup = {
  /** Display id 1–5000 (Cupscription #N) */
  id: number;
  name: string;
  ethscriptionId: string;
};

type Ethscription = {
  transaction_hash: string;
  current_owner: string;
};

type EthscriptionsPage = {
  result: Ethscription[];
  pagination: { page_key: string | null; has_more: boolean };
};

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function fetchOwnedCups(address: string): Promise<OwnedCup[]> {
  if (!isAddress(address)) {
    throw new Error("Invalid wallet address");
  }

  const owner = address.toLowerCase();
  const owned = new Map<number, OwnedCup>();
  const seenPageKeys = new Set<string>();
  let pageKey: string | undefined;

  do {
    const url = new URL(`${ETHSCRIPTIONS_API}/ethscriptions`);
    url.searchParams.set("current_owner", owner);
    url.searchParams.set("max_results", "50");
    if (pageKey) url.searchParams.set("page_key", pageKey);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`Ethscriptions API returned ${res.status}`);
    }

    const data = (await res.json()) as EthscriptionsPage;
    if (
      !Array.isArray(data.result) ||
      typeof data.pagination?.has_more !== "boolean"
    ) {
      throw new Error("Ethscriptions API returned an invalid ownership response");
    }

    for (const item of data.result) {
      if (
        typeof item.transaction_hash !== "string" ||
        typeof item.current_owner !== "string" ||
        item.current_owner.toLowerCase() !== owner
      ) {
        throw new Error("Ethscriptions API returned an invalid ownership record");
      }
      const cup = getCupMetaByEthscriptionId(item.transaction_hash);
      if (!cup) continue;
      owned.set(cup.id, {
        id: cup.id,
        name: cup.name,
        ethscriptionId: cup.ethscriptionId,
      });
    }

    if (!data.pagination.has_more) break;
    const nextKey = data.pagination.page_key;
    if (typeof nextKey !== "string" || !nextKey || seenPageKeys.has(nextKey)) {
      throw new Error("Ethscriptions API returned invalid ownership pagination");
    }
    seenPageKeys.add(nextKey);
    pageKey = nextKey;
  } while (pageKey);

  return [...owned.values()].sort((a, b) => a.id - b.id);
}
