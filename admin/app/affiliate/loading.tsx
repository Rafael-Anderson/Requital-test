import { CardSkeleton } from "@/components/ui/Skeleton";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

// app/affiliate/layout.tsx keeps BackButton/h1/AffiliateTabs mounted.
export default function Loading() {
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <ListPageSkeleton showBack={false} cols={5} rows={6} />
    </div>
  );
}
