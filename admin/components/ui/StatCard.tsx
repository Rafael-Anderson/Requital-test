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
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 p-4 transition-shadow hover:shadow-md dark:hover:shadow-none dark:hover:border-white/20">
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold mt-2 text-zinc-900 dark:text-zinc-50">{value}</div>
      {subtext && <div className="text-xs mt-1.5 text-zinc-400">{subtext}</div>}
      {change && (
        <div className="text-xs mt-1.5 flex items-center gap-1">
          {change.pct === null ? (
            <span className="text-zinc-400">New this period</span>
          ) : (
            <>
              <span
                className={`flex items-center gap-0.5 font-medium ${
                  change.pct >= 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {change.pct >= 0 ? (
                  <TrendingUp className="size-3.5" />
                ) : (
                  <TrendingDown className="size-3.5" />
                )}
                {Math.abs(change.pct).toFixed(1)}%
              </span>
              <span className="text-zinc-400">vs previous period</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
