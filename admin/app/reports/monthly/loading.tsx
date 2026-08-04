import Skeleton from "@/components/ui/Skeleton";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

// Matches ReportsFilterBar + GeneralReportView's own 4-stat-card row +
// table shape.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-9 w-full mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <ListPageSkeleton showBack={false} showTitle={false} showCreateButton={false} showSearch cols={5} rows={8} />
    </div>
  );
}
