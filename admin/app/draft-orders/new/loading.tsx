import Skeleton from "@/components/ui/Skeleton";
import { SplitFormSkeleton } from "@/components/ui/Skeleton";

// DraftOrderBuilder uses PageShell variant="split" (main + sticky summary
// sidebar), same shape as the product form.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-4 w-16 mb-4" />
      <Skeleton className="h-8 w-40 mb-4" />
      <SplitFormSkeleton />
    </div>
  );
}
