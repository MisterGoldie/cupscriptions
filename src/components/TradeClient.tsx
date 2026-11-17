"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatEther } from "viem";
import { marketFetch } from "@/lib/market/client";
import type { MarketResponse } from "@/lib/market/types";
import { MarketCupCards } from "./MarketCupCards";
import { WalletTrading } from "./WalletTrading";

export function TradeClient() {
  const [sort, setSort] = useState("price");
  const query = useInfiniteQuery({
    queryKey: ["market", "listings"], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => marketFetch<MarketResponse>(`/api/market${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 10_000, retry: 1,
  });
  const market = query.data?.pages[0]?.market;
  const cups = [...new Map((query.data?.pages.flatMap((page) => page.cups) ?? []).map((cup) => [cup.id, cup])).values()];
  cups.sort((a, b) => sort === "number" ? a.id - b.id : BigInt(a.priceWei) < BigInt(b.priceWei) ? -1 : BigInt(a.priceWei) > BigInt(b.priceWei) ? 1 : a.id - b.id);
  return <>
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div><p className="text-xs uppercase tracking-[0.25em] text-mute">Cupscriptions marketplace</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl font-extrabold text-bone">Trade cups</h1>
        <p className="mt-4 max-w-xl text-mute">Browse available cups or open a cup you own to sell it.</p></div>
      <Link href="/my-cups" className="border border-ash px-4 py-2 text-sm text-bone hover:border-volt hover:text-volt">Manage my cups</Link>
    </div>
    {query.isPending && <p className="text-mute">Checking available cups…</p>}
    {query.isError && <p className="border border-ash px-5 py-6 text-mute">Listings are temporarily unavailable. <button onClick={() => query.refetch()} className="text-volt underline">Retry</button></p>}
    {!query.isPending && !query.isError && !market && <div className="border border-ash bg-ink-soft p-6">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-bone">Trading is being prepared</h2>
      <p className="mt-3 max-w-xl text-mute">Buying and selling will appear here when the marketplace is available. You can browse the collection and view your cups today.</p>
      <Link className="mt-5 inline-block text-sm text-volt underline" href="/collection">Browse collection</Link>
    </div>}
    {market && <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-y border-ash py-4 text-sm text-mute">
        <p>{market.chainName} · {formatEther(BigInt(market.feeWei))} ETH fee per sale</p>
        <label>Sort loaded cups <select value={sort} onChange={(e) => setSort(e.target.value)} className="ml-2 border border-ash bg-ink-soft px-3 py-2 text-bone"><option value="price">Price: low to high</option><option value="number">Cup number</option></select></label>
      </div>
      {!market.canTrade && <p className="mb-6 text-sm text-mute">Buying and new listings are temporarily unavailable. You can still manage existing deposits and withdraw proceeds.</p>}
      {cups.length ? <MarketCupCards cups={cups} /> : <p className="py-8 text-mute">No cups are available on this page.</p>}
      {query.hasNextPage && <button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="mt-8 border border-ash px-5 py-3 text-sm text-bone disabled:opacity-40">{query.isFetchingNextPage ? "Loading…" : "Load more listings"}</button>}
    </>}
    <WalletTrading />
  </>;
}
