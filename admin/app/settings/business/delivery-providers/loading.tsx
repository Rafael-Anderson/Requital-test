import Skeleton from "@/components/ui/Skeleton";

// Mirrors ../payments/loading.tsx — same PageShell variant="form" shape.
export default function Loading() {
  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-surface dark:bg-zinc-900 p-6 space-y-3">
        <Skeleton className="h-3 w-32 mb-1" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
