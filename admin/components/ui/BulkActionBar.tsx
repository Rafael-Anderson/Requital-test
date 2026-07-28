"use client";

export default function BulkActionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5 mb-3 flex-wrap">
      <span className="text-sm font-medium">{count} selected</span>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline decoration-transparent hover:decoration-current cursor-pointer"
      >
        Clear
      </button>
    </div>
  );
}
