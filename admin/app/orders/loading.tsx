import Skeleton from "@/components/ui/Skeleton";

// Mirrors the live-orders kanban's real shape (app/orders/page.tsx): 4
// columns, each with a header row and a handful of card-shaped rows — not a
// generic spinner, so the board's structure is recognizable the instant
// navigation starts.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-4 w-16 mb-4" />
      <Skeleton className="h-8 w-40 mb-1" />
      <div className="flex gap-1 border-b border-gray-200 dark:border-white/10 mb-4">
        <Skeleton className="h-9 w-24 mb-0" />
        <Skeleton className="h-9 w-28 mb-0" />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: 4 }).map((_, col) => (
          <div
            key={col}
            className="flex-1 min-w-64 border border-gray-200 rounded-lg dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.02] p-3"
          >
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, card) => (
                <div key={card} className="rounded-lg border border-gray-200 dark:border-white/10 bg-surface dark:bg-zinc-900 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3.5 w-28 mb-1.5" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
