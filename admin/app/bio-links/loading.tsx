import Skeleton from "@/components/ui/Skeleton";
import { TableSkeleton } from "@/components/ui/Skeleton";

// Two-column layout — BioPageConfigCard on the left, the drag-reorderable
// links list on the right (see app/bio-links/page.tsx).
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-4 w-16 mb-4" />
      <Skeleton className="h-8 w-32 mb-4" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="rounded-lg border border-gray-200 dark:border-white/10 p-6 space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
            <TableSkeleton rows={4} cols={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
