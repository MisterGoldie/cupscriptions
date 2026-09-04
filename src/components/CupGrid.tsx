import Link from "next/link";
import { CupImage } from "@/components/CupImage";

type CupGridProps = {
  ids: number[];
};

export function CupGrid({ ids }: CupGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {ids.map((id, index) => (
        <Link
          key={id}
          href={`/cup/${id}`}
          className="cup-tile group relative aspect-square overflow-hidden bg-ink-soft"
          style={{ animationDelay: `${Math.min(index, 24) * 0.03}s` }}
        >
          <CupImage
            id={id}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
          />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent px-2 pb-2 pt-8 text-xs text-bone opacity-0 transition-opacity group-hover:opacity-100">
            #{id}
          </span>
        </Link>
      ))}
    </div>
  );
}
