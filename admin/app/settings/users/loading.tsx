import Skeleton from "@/components/ui/Skeleton";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

// Two stacked tables (staff accounts, branch-role assignments) — see
// app/settings/users/page.tsx's two <Table> instances.
export default function Loading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>
        <ListPageSkeleton showBack={false} showTitle={false} showCreateButton={false} cols={5} rows={5} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-28" />
        </div>
        <ListPageSkeleton showBack={false} showTitle={false} showCreateButton={false} cols={4} rows={4} />
      </div>
    </div>
  );
}
