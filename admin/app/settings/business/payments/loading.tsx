import Skeleton from "@/components/ui/Skeleton";

// PageShell variant="form" (single narrow column) — unlike the wide/grid
// settings tabs, this stacks one field per row.
export default function Loading() {
  return (
    <div className="max-w-4xl space-y-4">
      {Array.from({ length: 3 }).map((_, c) => (
        <div key={c} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-6 space-y-3">
          <Skeleton className="h-3 w-32 mb-1" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}
