import Skeleton from "@/components/ui/Skeleton";
import { CardSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="max-w-4xl">
      <Skeleton className="h-4 w-16 mb-4" />
      <Skeleton className="h-8 w-24 mb-1" />
      <Skeleton className="h-4 w-64 mb-6" />
      <CardSkeleton />
    </div>
  );
}
