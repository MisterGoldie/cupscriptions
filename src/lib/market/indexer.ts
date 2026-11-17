import { isAddress, type Address, type Hex } from "viem";
import { MarketError } from "./errors";

export type IndexedTransfer = {
  ethscription_transaction_hash: Hex;
  transaction_hash: Hex;
  from_address: Address;
  to_address: Address;
  block_number: string | number;
  block_blockhash: Hex;
  transaction_index: string | number;
  transfer_index: string | number;
  event_log_index: number | null;
};

export type IndexedCup = {
  transaction_hash: Hex;
  current_owner: Address;
  previous_owner: Address;
  ethscription_transfers?: IndexedTransfer[];
};

export function unsignedInteger(value: unknown): bigint {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value)) ||
      (typeof value === "number" && !Number.isSafeInteger(value))) {
    throw new MarketError("Ownership data could not be verified.");
  }
  return BigInt(value);
}

export function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function indexedCup(value: unknown): IndexedCup {
  const cup = value as IndexedCup;
  if (!cup || !isHash(cup.transaction_hash) || !isAddress(cup.current_owner, { strict: false }) ||
      !isAddress(cup.previous_owner, { strict: false })) {
    throw new MarketError("Ownership data could not be verified.");
  }
  return cup;
}

export function createMarketIndexer(baseUrl: string, fetcher: typeof fetch = fetch) {
  async function get(path: string, query?: URLSearchParams): Promise<unknown> {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/${path}`);
    if (query) url.search = query.toString();
    let response: Response;
    try {
      response = await fetcher(url.toString(), {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
    } catch { throw new MarketError("The ownership indexer is temporarily unavailable."); }
    if (!response.ok) throw new MarketError("The ownership indexer is temporarily unavailable.");
    try { return await response.json(); }
    catch { throw new MarketError("Ownership data could not be verified."); }
  }

  return {
    async assertFresh(blockNumber: bigint) {
      const status = await get("status") as Record<string, unknown>;
      if (!status || unsignedInteger(status.last_imported_block) < blockNumber ||
          unsignedInteger(status.current_block_number) < blockNumber ||
          unsignedInteger(status.last_imported_block) > unsignedInteger(status.current_block_number)) {
        throw new MarketError("Ownership is still updating. Please refresh in a moment.");
      }
    },
    async cup(id: Hex) {
      const data = await get(`ethscriptions/${id}`) as { result?: unknown };
      const cup = indexedCup(data?.result);
      if (cup.transaction_hash.toLowerCase() !== id.toLowerCase()) throw new MarketError("Ownership data could not be verified.");
      return cup;
    },
    async escrowPage(market: Address, wallet?: Address, cursor?: string) {
      const query = new URLSearchParams({ current_owner: market, max_results: "24", sort_by: "newest_first" });
      if (wallet) query.set("previous_owner", wallet);
      if (cursor) query.set("page_key", cursor);
      const data = await get("ethscriptions", query) as {
        result?: unknown[]; pagination?: { has_more?: unknown; page_key?: unknown };
      };
      if (!Array.isArray(data?.result) || typeof data.pagination?.has_more !== "boolean") {
        throw new MarketError("Ownership data could not be verified.");
      }
      const cups = data.result.map(indexedCup);
      if (cups.some((cup) => cup.current_owner.toLowerCase() !== market.toLowerCase() ||
          (wallet && cup.previous_owner.toLowerCase() !== wallet.toLowerCase()))) {
        throw new MarketError("Ownership data could not be verified.");
      }
      const next = data.pagination.has_more ? data.pagination.page_key : null;
      if (next !== null && (typeof next !== "string" || !next || next.length > 200 || next === cursor)) {
        throw new MarketError("Ownership pagination could not be verified.");
      }
      return { cups, nextCursor: next as string | null };
    },
  };
}

export type MarketIndexer = ReturnType<typeof createMarketIndexer>;
