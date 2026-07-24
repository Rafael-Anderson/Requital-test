export default function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="size-10 text-zinc-300 dark:text-zinc-700"
        aria-hidden="true"
      >
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M3 7l2.5-4h13L21 7" />
        <path d="M9 11h6" />
      </svg>
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {description && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-xs">{description}</p>
      )}
    </div>
  );
}
