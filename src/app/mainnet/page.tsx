import { notFound } from "next/navigation";
import { SepoliaDeployment } from "@/components/SepoliaDeployment";

export const dynamic = "force-dynamic";

export default function MainnetSetupPage() {
  if (process.env.NODE_ENV !== "development" || process.env.CUPSCRIPTIONS_MAINNET_PREVIEW !== "1" || process.env.CUPSCRIPTIONS_SEPOLIA_PREVIEW === "1") notFound();
  return <div className="px-5 pb-24 pt-28 md:px-8"><div className="mx-auto max-w-3xl">
    <p className="text-xs uppercase tracking-[0.25em] text-volt">Ethereum mainnet · Operator setup</p>
    <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-extrabold text-bone">Launch Cupscriptions trading</h1>
    <p className="mt-4 text-mute">Deploy the marketplace for the original 5,000 Cupscriptions. The wallet transaction uses real ETH for gas.</p>
    <SepoliaDeployment network="mainnet" />
  </div></div>;
}
