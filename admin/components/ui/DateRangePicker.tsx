export interface DateRange {
  from: string;
  to: string;
}

// UAE/Gulf merchants run on UTC+4 year-round — "today" here must match the
// backend's UAE-local day boundary (DashboardService.resolveRange), not the
// browser/server's UTC calendar date. Without the shift, "today" can read as
// yesterday for several hours a day (any time before 4am UTC = before
// midnight UAE... inverted: UTC evening is already the next UAE day), and
// the default range silently excludes same-day orders.
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

function toDateKey(d: Date): string {
  return new Date(d.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);
}

export function defaultDateRange(days = 30): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: toDateKey(from), to: toDateKey(to) };
}

const dateInputClass =
  "h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15";

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const today = toDateKey(new Date());
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={value.from}
        max={value.to}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className={dateInputClass}
      />
      <span className="text-zinc-400 text-sm">to</span>
      <input
        type="date"
        value={value.to}
        min={value.from}
        max={today}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className={dateInputClass}
      />
    </div>
  );
}
