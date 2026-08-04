import Skeleton from "@/components/ui/Skeleton";
import { FormPageSkeleton } from "@/components/ui/Skeleton";

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
      <FormPageSkeleton showBack={false} fields={3} />
    </div>
  );
}
