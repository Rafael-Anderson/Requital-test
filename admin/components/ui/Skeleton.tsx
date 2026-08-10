export default function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-black/10 dark:bg-white/10 ${className}`}
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-black/5 dark:divide-white/10">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 p-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 p-4">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-7 w-28" />
    </div>
  );
}

// Shared shape for loading.tsx on any list/table page (Inventory,
// Customers, Templates, Discounts, Affiliate, Bio Links, Activity Log,
// Outlets/Users settings, Reports, ...) — title + optional create button,
// optional tabs, optional search bar, then a header row + TableSkeleton
// body, matching the real Table/THead/TR shape those pages render into.
export function ListPageSkeleton({
  cols = 5,
  rows = 8,
  showBack = true,
  showTitle = true,
  showCreateButton = true,
  showTabs = false,
  showSearch = false,
}: {
  cols?: number;
  rows?: number;
  showBack?: boolean;
  showTitle?: boolean;
  showCreateButton?: boolean;
  showTabs?: boolean;
  showSearch?: boolean;
}) {
  return (
    <div>
      {showBack && <Skeleton className="h-4 w-16 mb-4" />}
      {(showTitle || showCreateButton) && (
        <div className="flex items-center justify-between mb-4 gap-3">
          {showTitle && <Skeleton className="h-8 w-48" />}
          {showCreateButton && <Skeleton className="h-9 w-28 shrink-0" />}
        </div>
      )}
      {showTabs && (
        <div className="flex gap-1 border-b border-gray-200 dark:border-white/10 mb-4">
          <Skeleton className="h-9 w-24 mb-0" />
          <Skeleton className="h-9 w-28 mb-0" />
        </div>
      )}
      {showSearch && <Skeleton className="h-9 w-64 mb-4" />}
      <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
        <div className="flex items-center gap-4 p-3 bg-black/[0.03] dark:bg-white/5">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        <TableSkeleton rows={rows} cols={cols} />
      </div>
    </div>
  );
}

// Shared shape for loading.tsx on a single-column data-entry/detail page
// (Business Settings tabs, Theme editor tabs, new/edit forms) — a title
// then a card of label+field pairs, matching PageShell's "form" variant.
export function FormPageSkeleton({
  fields = 6,
  showBack = true,
}: {
  fields?: number;
  showBack?: boolean;
}) {
  return (
    <div className="max-w-4xl">
      {showBack && <Skeleton className="h-4 w-16 mb-4" />}
      <Skeleton className="h-8 w-48 mb-6" />
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-6 space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-24 mb-1.5" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared shape for loading.tsx on a PageShell variant="split" page (product
// new/edit) — wide main column plus a sticky sidebar, matching
// ProductForm's own layout instead of a single centered column.
export function SplitFormSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <div className="lg:col-span-2 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-white/10 p-6 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-white/10 p-6 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared shape for loading.tsx on a settings tab's *content area only*
// (app/settings/business/*, app/settings/outlets/[id]/edit) — the
// persistent layout.tsx (BackButton/h1/tabs or the sub-nav sidebar) stays
// mounted and doesn't need its own skeleton, so this only covers what
// swaps: a stack of Cards, each with a grid of label+field pairs, matching
// this app's own "Settings/config page layout convention" (Card containers,
// grid-cols-1 sm:grid-cols-2 lg:grid-cols-3).
export function SettingsCardsSkeleton({ cards = 3, fieldsPerCard = 3 }: { cards?: number; fieldsPerCard?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: cards }).map((_, c) => (
        <div key={c} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-6">
          <Skeleton className="h-3 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: fieldsPerCard }).map((_, f) => (
              <div key={f}>
                <Skeleton className="h-3 w-20 mb-1.5" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Shared shape for loading.tsx on the Dashboard — a stat-card row plus a
// large chart area, matching StatCard's grid and the revenue chart below it.
export function DashboardSkeleton() {
  return (
    <div>
      <Skeleton className="h-8 w-48 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
