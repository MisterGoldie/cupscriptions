import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CupImage } from "@/components/CupImage";
import { clampCupId, cupImageUrl, SUPPLY } from "@/lib/cups";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id: raw } = await params;
  const id = clampCupId(Number(raw));
  if (!id) return { title: "Not found" };
  return {
    title: `Cupscription #${id}`,
    description: `Cupscription #${id} — hand-drawn Ethscription by Goldie.`,
    openGraph: {
      images: [cupImageUrl(id)],
    },
  };
}

export default async function CupPage({ params }: PageProps) {
  const { id: raw } = await params;
  const id = clampCupId(Number(raw));
  if (!id) notFound();

  const prev = id > 1 ? id - 1 : null;
  const next = id < SUPPLY ? id + 1 : null;

  return (
    <div className="px-5 pb-20 pt-24 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-start">
        <div className="relative aspect-square overflow-hidden bg-ink-soft">
          <CupImage
            id={id}
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        </div>

        <div className="flex flex-col gap-8 lg:pt-6">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-mute">
              Cupscription
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-bone md:text-6xl">
              #{id}
            </h1>
            <p className="mt-4 max-w-md text-mute">
              One of {SUPPLY.toLocaleString()} hand-drawn cups inscribed as an
              Ethscription on Ethereum.
            </p>
          </div>

          <dl className="grid gap-4 border-y border-ash py-6 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-mute">Artist</dt>
              <dd className="text-bone">Goldie</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mute">Protocol</dt>
              <dd className="text-bone">Ethscriptions</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mute">Image</dt>
              <dd>
                <a
                  href={cupImageUrl(id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ember transition hover:text-ember-hot"
                >
                  Open IPFS
                </a>
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3">
            {prev ? (
              <Link
                href={`/cup/${prev}`}
                className="border border-ash px-4 py-2 text-sm text-bone transition hover:border-mute"
              >
                ← #{prev}
              </Link>
            ) : null}
            <Link
              href="/collection"
              className="border border-ash px-4 py-2 text-sm text-bone transition hover:border-mute"
            >
              All cups
            </Link>
            {next ? (
              <Link
                href={`/cup/${next}`}
                className="border border-ash px-4 py-2 text-sm text-bone transition hover:border-mute"
              >
                #{next} →
              </Link>
            ) : null}
          </div>

          <Link
            href="/trade"
            className="inline-flex w-fit bg-ember px-5 py-3 text-sm font-semibold text-bone transition hover:bg-ember-hot"
          >
            Trade (coming soon)
          </Link>
        </div>
      </div>
    </div>
  );
}
