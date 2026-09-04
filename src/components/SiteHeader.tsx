import Link from "next/link";

const links = [
  { href: "/collection", label: "Collection" },
  { href: "/trade", label: "Trade" },
];

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-bone md:text-xl"
        >
          Cupscriptions
        </Link>
        <nav className="flex items-center gap-6 text-sm text-mute">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-bone"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
