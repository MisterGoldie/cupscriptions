import Link from "next/link";
import { CupImage } from "@/components/CupImage";
import { SUPPLY } from "@/lib/cups";

const HERO_IDS = [34, 70, 104, 482, 718, 1199, 1500, 2001, 2500, 3000, 3500, 4050];

export default function HomePage() {
  return (
    <>
      <section className="relative isolate min-h-[100svh] overflow-hidden">
        <div className="mosaic-layer absolute inset-0 -z-20 grid grid-cols-3 gap-1 opacity-45 sm:grid-cols-4 md:grid-cols-6">
          {HERO_IDS.map((id) => (
            <div key={id} className="relative min-h-[34vh] overflow-hidden">
              <CupImage
                id={id}
                fill
                priority={id === 34 || id === 70}
                className="object-cover"
                sizes="20vw"
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/70 via-ink/80 to-ink" />
        <div className="ember-glow pointer-events-none absolute -left-24 top-1/3 -z-10 h-72 w-72 rounded-full bg-ember/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-1/4 -z-10 h-64 w-64 rounded-full bg-glaze/25 blur-3xl" />

        <div className="mx-auto flex min-h-[100svh] max-w-5xl flex-col justify-end px-5 pb-16 pt-28 md:justify-center md:px-8 md:pb-24">
          <p className="animate-rise text-sm uppercase tracking-[0.28em] text-mute">
            Ethscriptions · 5,000 cups
          </p>
          <h1 className="animate-rise animate-rise-delay-1 mt-4 font-[family-name:var(--font-display)] text-6xl font-extrabold leading-[0.92] tracking-tight text-bone sm:text-7xl md:text-8xl">
            Cupscriptions
          </h1>
          <p className="animate-rise animate-rise-delay-2 mt-6 max-w-md text-lg text-mute md:text-xl">
            Hand-drawn cups by Goldie — inscribed on Ethereum, still pourable on
            the open web.
          </p>
          <div className="animate-rise animate-rise-delay-3 mt-10 flex flex-wrap gap-4">
            <Link
              href="/collection"
              className="bg-ember px-6 py-3 text-sm font-semibold tracking-wide text-bone transition hover:bg-ember-hot"
            >
              Browse {SUPPLY.toLocaleString()}
            </Link>
            <Link
              href="/trade"
              className="border border-bone/25 px-6 py-3 text-sm font-semibold tracking-wide text-bone transition hover:border-bone/60"
            >
              Trade soon
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-ash px-5 py-20 md:px-8">
        <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[1.2fr_1fr] md:items-end">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-bone md:text-4xl">
              One cup. One inscription.
            </h2>
            <p className="mt-4 max-w-lg text-mute">
              Minted December 2023 on Ethscriptions. Images are served from a
              public IPFS pin so the art stays reachable even as old explorers
              fade.
            </p>
          </div>
          <Link
            href="/collection"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-ember transition hover:text-ember-hot"
          >
            Enter the kiln →
          </Link>
        </div>
      </section>
    </>
  );
}
