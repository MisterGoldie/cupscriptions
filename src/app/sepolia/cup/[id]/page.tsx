import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import manifest from "@/data/sepolia-cupscriptions.json";
import type { SepoliaItem } from "@/lib/market/collection";
import { CupTrading } from "@/components/CupTrading";

export const dynamic = "force-dynamic";

export default async function TestCupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = (manifest.items as SepoliaItem[]).find((cup) => String(cup.number) === id);
  if (!item) notFound();
  return <div className="px-5 pb-24 pt-28 md:px-8"><div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
    <Image src={`/sepolia/test-cup-${item.number}.svg`} alt={`Sepolia Test Cup #${item.number}`} width={600} height={600} className="w-full" priority />
    <div>
      <p className="text-xs uppercase tracking-[0.25em] text-volt">Ethereum Sepolia · Test network</p>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-extrabold text-bone">Test Cup #{item.number}</h1>
      <p className="mt-4 text-mute">A separate test inscription for marketplace testing.</p>
      <a href={`https://sepolia.etherscan.io/tx/${item.ethscriptionId}`} target="_blank" rel="noreferrer" className="my-5 block break-all text-xs text-volt underline">Creation: {item.ethscriptionId}</a>
      <CupTrading id={item.number} ethscriptionId={item.ethscriptionId} testnet />
      <Link href="/sepolia" className="mt-8 inline-block text-sm text-volt underline">All test cups</Link>
    </div>
  </div></div>;
}
