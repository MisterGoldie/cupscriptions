"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { marketAbi } from "@/lib/market/abi.generated";
import { marketFetch, useMarketTransaction } from "@/lib/market/client";
import type { MarketResponse } from "@/lib/market/types";
import { MarketCupCards } from "./MarketCupCards";
import { TradingStatus } from "./TradingStatus";

export function WalletTrading() {
  const { address, isConnected } = useAccount();
  const query = useInfiniteQuery({
    queryKey: ["market", "wallet", address], enabled: isConnected && !!address,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => marketFetch<MarketResponse>(`/api/market?wallet=${address}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 10_000, retry: 1,
  });
  const first = query.data?.pages[0];
  const market = first?.market ?? null;
  const tx = useMarketTransaction(market);
  const cups = [...new Map((query.data?.pages.flatMap((page) => page.cups) ?? []).map((cup) => [cup.id, cup])).values()];
  const proceeds = BigInt(first?.proceedsWei ?? "0");

  async function withdraw() {
    if (!market || !address || proceeds === 0n) return;
    await tx.run("Proceeds withdrawal", async (wallet, client, assertWallet) => {
      const { request } = await client.simulateContract({ address: market.address, abi: marketAbi, functionName: "withdrawProceeds",
        account: wallet.account, args: [wallet.account.address] });
      await assertWallet(); return wallet.writeContract(request);
    });
  }
  if (!isConnected || !address) return null;
  if (query.isError && !market) return <p className="mt-8 text-sm text-mute">Escrow and proceeds could not be loaded. <button className="text-volt underline" onClick={() => query.refetch()}>Retry</button></p>;
  if (!market) return null;
  return <section className="mt-12 border-t border-ash pt-8" aria-label="Your marketplace cups and proceeds">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-bone">Your marketplace</h2><p className="text-sm text-mute">{market.chainName}</p>
    </div>
    {proceeds > 0n && <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border border-ash bg-ink-soft px-5 py-4">
      <div><p className="text-xs uppercase tracking-widest text-mute">Available proceeds</p><p className="mt-1 text-xl text-bone">{formatEther(proceeds)} ETH</p></div>
      <button onClick={withdraw} disabled={tx.busy} className="border border-volt px-4 py-2 text-sm text-volt disabled:opacity-40">Withdraw proceeds</button>
    </div>}
    {first?.error && <p className="mb-4 text-sm text-mute">{first.error}</p>}
    {query.isError && <p className="mb-4 text-sm text-mute">Some marketplace data could not be refreshed. <button className="text-volt underline" onClick={() => query.refetch()}>Retry</button></p>}
    {cups.length > 0 ? <><p className="mb-4 text-sm text-mute">Cups in escrow. Open a cup to manage its listing or return it to your wallet.</p><MarketCupCards cups={cups} /></>
      : !first?.error && <p className="text-sm text-mute">You have no cups in this marketplace’s escrow.</p>}
    {query.hasNextPage && <button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="mt-6 border border-ash px-4 py-2 text-sm text-bone disabled:opacity-40">{query.isFetchingNextPage ? "Loading…" : "Load more escrowed cups"}</button>}
    <TradingStatus market={market} message={tx.message} hash={tx.hash} onCheck={tx.pending ? tx.recheck : undefined} />
  </section>;
}
