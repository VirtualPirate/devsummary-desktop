import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonList({
  rows = 4,
  rowHeight = 56,
}: {
  rows?: number;
  rowHeight?: number;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="w-full rounded-2xl" style={{ height: rowHeight }} />
      ))}
    </div>
  );
}

export function SkeletonGrid({
  cards = 6,
  cardHeight = 140,
}: {
  cards?: number;
  cardHeight?: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className="w-full rounded-2xl" style={{ height: cardHeight }} />
      ))}
    </div>
  );
}
