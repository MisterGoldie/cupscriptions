import Link from "next/link";
import { formatEther } from "viem";
import type { MarketCup } from "@/lib/market/types";
import { CupImage } from "./CupImage";
import Image from "next/image";

export function MarketCupCards({ cups }: { cups: MarketCup[] }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {cups.map((cup) => <Link key={cup.id} href={`${cup.testnet ? "/sepolia/cup" : "/cup"}/${cup.id}`} className="cup-tile overflow-hidden border border-ash bg-ink-soft">
      <div className="relative aspect-square">{cup.testnet ? <Image src={`/sepolia/test-cup-${cup.id}.svg`} alt={`Sepolia test cup ${cup.id}`} fill unoptimized /> : <CupImage id={cup.id} fill className="object-cover" sizes="(max-width:640px) 50vw, 25vw" />}</div>
      <div className="px-3 py-3">
        <p className="text-sm font-semibold text-bone">{cup.testnet ? "Sepolia Test Cup" : "Cupscription"} #{cup.id}</p>
        <p className="mt-1 text-sm text-volt">{!cup.verified ? "Awaiting confirmation" : BigInt(cup.priceWei) > 0n ? `${formatEther(BigInt(cup.priceWei))} ETH` : "In escrow · not listed"}</p>
        {!!cup.remainingBlocks && <p className="mt-1 text-xs text-mute">Cooldown: {cup.remainingBlocks} blocks</p>}
      </div>
    </Link>)}
  </div>;
}
