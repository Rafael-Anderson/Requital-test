import type { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

// Card shape (rounded, bordered, label-then-value layout) adapted from
// "Stats Widget" by ravikatiyar162 on 21st.dev
// (https://21st.dev/@ravikatiyar162/components/stats-widget). The original
// also renders a trend delta; that was dropped in an earlier pass because no
// real period-over-period comparison existed then. The dashboard rebuild
// computes a real one, so `change` brings the delta back — still opt-in, and
// `null` (previous period had zero to compare against) renders as "New"
// rather than a nonsensical percentage.
export default function StatCard({
  label,
  value,
  icon,
  change,
  subtext,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  change?: { pct: number | null };
  subtext?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-text-muted dark:text-zinc-400">
        {icon}
        {label}
      </div>
      <div className="mt-3.5 text-2xl font-extrabold text-text-primary dark:text-zinc-50">{value}</div>
      {subtext && <div className="mt-2 text-[12.5px] text-text-faint dark:text-zinc-500">{subtext}</div>}
      {change && (
        <div className="mt-2 flex items-center gap-1 text-[12.5px]">
          {change.pct === null ? (
            <span className="text-text-faint dark:text-zinc-500">New this period</span>
          ) : (
            <>
              <span
                className={`flex items-center gap-0.5 font-medium ${
                  change.pct >= 0
                    ? "text-success dark:text-green-400"
                    : "text-danger-text dark:text-red-400"
                }`}
              >
                {change.pct >= 0 ? (
                  <TrendingUp className="size-3.5" />
                ) : (
                  <TrendingDown className="size-3.5" />
                )}
                {Math.abs(change.pct).toFixed(1)}%
              </span>
              <span className="text-text-faint dark:text-zinc-500">vs previous period</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
