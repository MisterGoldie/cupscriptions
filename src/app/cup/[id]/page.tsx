import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CupImage } from "@/components/CupImage";
import { clampCupId, cupImageUrl, SUPPLY } from "@/lib/cups";
import { getCupMeta } from "@/lib/traits";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id: raw } = await params;
  const id = clampCupId(Number(raw));
  if (!id) return { title: "Not found" };
  const meta = getCupMeta(id);
  const traitLine = meta?.attributes
    .map((a) => `${a.trait_type}: ${a.value}`)
    .slice(0, 3)
    .join(" · ");
  return {
    title: meta?.name ?? `Cupscription #${id}`,
    description:
      traitLine ||
      `Cupscription #${id} — hand-drawn Ethscription by Goldie.`,
    openGraph: {
      images: [cupImageUrl(id)],
    },
  };
}

export default async function CupPage({ params }: PageProps) {
  const { id: raw } = await params;
  const id = clampCupId(Number(raw));
  if (!id) notFound();

  const meta = getCupMeta(id);
  const prev = id > 1 ? id - 1 : null;
  const next = id < SUPPLY ? id + 1 : null;
  const attributes = meta?.attributes ?? [];

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
              {meta?.name ?? `Cupscription #${id}`} — one of{" "}
              {SUPPLY.toLocaleString()} hand-drawn cups inscribed as an
              Ethscription on Ethereum.
            </p>
          </div>

          {attributes.length > 0 ? (
            <div>
              <h2 className="text-sm uppercase tracking-[0.28em] text-mute">
                Traits
              </h2>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {attributes.map((attr) => (
                  <li
                    key={`${attr.trait_type}-${attr.value}`}
                    className="border border-ash border-l-volt bg-ink-soft px-3 py-3"
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-mute">
                      {attr.trait_type}
                    </p>
                    <p className="mt-1 text-sm font-medium text-bone">
                      {attr.value}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <dl className="grid gap-4 border-y border-ash py-6 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-mute">Protocol</dt>
              <dd className="text-bone">Ethscriptions</dd>
            </div>
            {meta?.ethscriptionId ? (
              <div className="flex justify-between gap-4">
                <dt className="text-mute">Ethscription</dt>
                <dd className="truncate text-bone" title={meta.ethscriptionId}>
                  {meta.ethscriptionId.slice(0, 10)}…
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-mute">Image</dt>
              <dd>
                <a
                  href={cupImageUrl(id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-volt transition hover:text-volt-hot"
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
            className="inline-flex w-fit bg-volt px-5 py-3 text-sm font-semibold text-ink transition hover:bg-volt-hot"
          >
            Trade (coming soon)
          </Link>
        </div>
      </div>
    </div>
  );
}
