import Link from "next/link";
import type { Metadata } from "next";
import { CupGrid } from "@/components/CupGrid";
import { JumpToCup } from "@/components/JumpToCup";
import { pageCupIds, SUPPLY, totalPages } from "@/lib/cups";

export const metadata: Metadata = {
  title: "Collection",
  description: "Browse all 5,000 Cupscriptions.",
};

const PER_PAGE = 24;

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function CollectionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = Number(params.page ?? "1");
  const pages = totalPages(PER_PAGE);
  const page = Number.isFinite(raw) ? Math.min(Math.max(1, Math.floor(raw)), pages) : 1;
  const ids = pageCupIds(page, PER_PAGE);

  return (
    <div className="px-5 pb-20 pt-24 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-bone md:text-5xl">
              Collection
            </h1>
            <p className="mt-2 text-mute">
              {SUPPLY.toLocaleString()} cups · page {page} of {pages}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <JumpToCup />
            <Pagination page={page} pages={pages} />
          </div>
        </div>

        <CupGrid ids={ids} />

        <div className="mt-12 flex justify-center">
          <Pagination page={page} pages={pages} />
        </div>
      </div>
    </div>
  );
}

function Pagination({ page, pages }: { page: number; pages: number }) {
  const prev = page > 1 ? page - 1 : null;
  const next = page < pages ? page + 1 : null;

  return (
    <div className="flex items-center gap-3 text-sm">
      {prev ? (
        <Link
          href={`/collection?page=${prev}`}
          className="border border-ash px-3 py-2 text-bone transition hover:border-mute"
        >
          Prev
        </Link>
      ) : (
        <span className="border border-transparent px-3 py-2 text-mute/40">Prev</span>
      )}
      <span className="text-mute">
        {page} / {pages}
      </span>
      {next ? (
        <Link
          href={`/collection?page=${next}`}
          className="border border-ash px-3 py-2 text-bone transition hover:border-mute"
        >
          Next
        </Link>
      ) : (
        <span className="border border-transparent px-3 py-2 text-mute/40">Next</span>
      )}
    </div>
  );
}
