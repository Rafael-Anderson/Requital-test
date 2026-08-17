export default function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2.5 py-16 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="size-[30px] text-[#C9D0CE] dark:text-zinc-700"
        aria-hidden="true"
      >
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M3 7l2.5-4h13L21 7" />
        <path d="M9 11h6" />
      </svg>
      <p className="text-[13.5px] text-text-faint dark:text-zinc-400">{title}</p>
      {description && (
        <p className="max-w-xs text-xs text-text-faint/80 dark:text-zinc-500">{description}</p>
      )}
    </div>
  );
}
