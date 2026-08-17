import Skeleton from "@/components/ui/Skeleton";

// PageShell variant="form" (single narrow column).
export default function Loading() {
  return (
    <div className="max-w-4xl rounded-lg border border-gray-200 dark:border-white/10 bg-surface dark:bg-zinc-900 p-6 space-y-4">
      <div>
        <Skeleton className="h-3 w-24 mb-1.5" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div>
        <Skeleton className="h-3 w-32 mb-1.5" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div>
        <Skeleton className="h-3 w-24 mb-1.5" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
