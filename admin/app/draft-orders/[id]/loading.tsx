import Skeleton from "@/components/ui/Skeleton";
import { CardSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-4xl">
      <Skeleton className="h-4 w-16 mb-4" />
      <Skeleton className="h-8 w-64 mb-4" />
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
