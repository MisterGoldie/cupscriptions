import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trade",
  description: "Trading for Cupscriptions is coming soon.",
};

export default function TradePage() {
  return (
    <div className="px-5 pb-24 pt-28 md:px-8">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm uppercase tracking-[0.28em] text-mute">Marketplace</p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-bone">
          Trade is on the way
        </h1>
        <p className="mt-6 text-lg text-mute">
          Ethscriptions.com retired its marketplace UI, but the underlying
          contract is still live. This site will add listings and buys against
          that permissionless market — or a custom flow — without relying on
          their front-end.
        </p>
        <ul className="mt-8 space-y-3 text-mute">
          <li className="border-l-2 border-volt pl-4">
            Browse and share cups from the collection today
          </li>
          <li className="border-l-2 border-ash pl-4">
            Wallet connect + deposit / list / buy next
          </li>
          <li className="border-l-2 border-ash pl-4">
            Withdrawals stay available on the original marketplace contract
          </li>
        </ul>
        <Link
          href="/collection"
          className="mt-10 inline-flex bg-volt px-6 py-3 text-sm font-semibold text-ink transition hover:bg-volt-hot"
        >
          Back to collection
        </Link>
      </div>
    </div>
  );
}
