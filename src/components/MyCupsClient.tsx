"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAccount } from "wagmi";
import { CupGrid } from "@/components/CupGrid";
import { WalletButton } from "@/components/WalletButton";
import type { OwnedCup } from "@/lib/ownership";

type OwnedResponse = {
  cups: OwnedCup[];
  count: number;
  error?: string;
};

export function MyCupsClient() {
  const { address, isConnected } = useAccount();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["owned-cups", address],
    enabled: Boolean(address),
    queryFn: async (): Promise<OwnedResponse> => {
      const res = await fetch(`/api/owned/${address}`);
      const json = (await res.json()) as OwnedResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load owned cups");
      }
      return json;
    },
  });

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-sm uppercase tracking-[0.28em] text-mute">Wallet</p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-bone">
          Connect to see your cups
        </h1>
        <p className="mt-6 text-lg text-mute">
          Link an Ethereum wallet to load Cupscriptions you own on-chain via the
          Ethscriptions indexer.
        </p>
        <div className="mt-8">
          <WalletButton />
        </div>
      </div>
    );
  }

  const ids = data?.cups.map((cup) => cup.id) ?? [];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-mute">
            Your collection
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-bone md:text-5xl">
            My Cups
          </h1>
          <p className="mt-2 text-mute">
            {isLoading || isFetching
              ? "Looking up ownership…"
              : `${data?.count ?? 0} cup${data?.count === 1 ? "" : "s"} in this wallet`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="border border-ash px-3 py-2 text-sm text-bone transition hover:border-volt hover:text-volt"
          >
            Refresh
          </button>
          <WalletButton />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse bg-ash" />
          ))}
        </div>
      ) : null}

      {isError ? (
        <div className="border border-ash bg-ink-soft px-5 py-6">
          <p className="text-bone">Couldn’t load ownership.</p>
          <p className="mt-2 text-sm text-mute">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      ) : null}

      {!isLoading && !isError && ids.length === 0 ? (
        <div className="border border-ash bg-ink-soft px-5 py-10">
          <p className="text-lg text-bone">No Cupscriptions in this wallet.</p>
          <p className="mt-2 max-w-lg text-mute">
            Ownership is read from the Ethscriptions explorer for the CUP
            collection contract. If you just received a cup, hit Refresh in a
            minute.
          </p>
          <Link
            href="/collection"
            className="mt-6 inline-flex bg-volt px-5 py-3 text-sm font-semibold text-ink transition hover:bg-volt-hot"
          >
            Browse collection
          </Link>
        </div>
      ) : null}

      {ids.length > 0 ? <CupGrid ids={ids} /> : null}
    </div>
  );
}
