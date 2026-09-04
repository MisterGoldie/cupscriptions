import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";

const links = [
  { href: "/collection", label: "Collection" },
  { href: "/my-cups", label: "My Cups" },
  { href: "/trade", label: "Trade" },
];

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 md:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-bone md:text-xl"
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-volt shadow-[0_0_12px_var(--volt)] transition group-hover:scale-125"
          />
          Cupscriptions
        </Link>
        <div className="flex items-center gap-4 md:gap-6">
          <nav className="hidden items-center gap-6 text-sm text-mute sm:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-volt"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
