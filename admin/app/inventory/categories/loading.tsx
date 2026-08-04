import { ListPageSkeleton } from "@/components/ui/Skeleton";
import Skeleton from "@/components/ui/Skeleton";

// Two stacked tables (Product Categories, Ingredient Categories) — see
// app/inventory/categories/page.tsx's two <h1>s.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-4 w-16 mb-4" />
      <div className="flex gap-1 border-b dark:border-white/10 mb-4">
        <Skeleton className="h-9 w-24 mb-0" />
        <Skeleton className="h-9 w-28 mb-0" />
        <Skeleton className="h-9 w-24 mb-0" />
        <Skeleton className="h-9 w-28 mb-0" />
      </div>
      <div className="space-y-8">
        <ListPageSkeleton showBack={false} cols={4} rows={5} />
        <ListPageSkeleton showBack={false} cols={4} rows={5} />
      </div>
    </div>
  );
}
