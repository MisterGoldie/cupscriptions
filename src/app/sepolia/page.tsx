import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import manifest from "@/data/sepolia-cupscriptions.json";
import type { SepoliaItem } from "@/lib/market/collection";
import { SepoliaSetup } from "@/components/SepoliaSetup";
import { WalletTrading } from "@/components/WalletTrading";
import { SepoliaDeployment } from "@/components/SepoliaDeployment";

export const metadata: Metadata = { title: "Sepolia test collection", description: "Create and trade three Cupscriptions test inscriptions on Ethereum Sepolia." };
export const dynamic = "force-dynamic";

export default function SepoliaPage() {
  const items = manifest.items as SepoliaItem[];
  return <div className="px-5 pb-24 pt-28 md:px-8"><div className="mx-auto max-w-5xl">
    <p className="text-xs uppercase tracking-[0.25em] text-volt">Ethereum Sepolia · Test network</p>
    <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl font-extrabold text-bone">Test cups</h1>
    <p className="mt-4 max-w-xl text-mute">Three test inscriptions for trying deposits, listings, purchases and withdrawals. Your 5,000 mainnet Cupscriptions remain on Ethereum mainnet.</p>
    {process.env.NODE_ENV === "development" && <SepoliaSetup />}
    {process.env.NODE_ENV === "development" && items.length === 3 && <SepoliaDeployment />}
    <div className="mt-8 grid gap-5 sm:grid-cols-3">{[1, 2, 3].map((number) => {
      const item = items.find((cup) => cup.number === number);
      return <div key={number} className="border border-ash bg-ink-soft p-3">
        <Image src={`/sepolia/test-cup-${number}.svg`} alt={`Sepolia Test Cup #${number}`} width={600} height={600} className="aspect-square w-full" />
        <h2 className="mt-3 font-semibold text-bone">Sepolia Test Cup #{number}</h2>
        {item ? <Link href={`/sepolia/cup/${number}`} className="mt-2 inline-block text-sm text-volt underline">Open test cup</Link>
          : <p className="mt-2 text-sm text-mute">Awaiting confirmed creation</p>}
      </div>;
    })}</div>
    {process.env.MARKET_CHAIN_ID === "11155111" && items.length === 3 && <WalletTrading />}
    <Link href="/collection" className="mt-8 inline-block text-sm text-volt underline">Back to mainnet collection</Link>
  </div></div>;
}
