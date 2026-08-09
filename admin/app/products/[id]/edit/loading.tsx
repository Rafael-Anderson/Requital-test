import Skeleton from "@/components/ui/Skeleton";
import { SplitFormSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-4 w-24 mb-4" />
      <Skeleton className="h-8 w-40 mb-4" />
      <SplitFormSkeleton />
    </div>
  );
}
