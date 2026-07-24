// Standard SVG donut technique: stacked circles sharing one radius, each
// drawn as a dash of its own share of the circumference and offset to start
// where the previous one ended. No charting library needed for this.
export const SEGMENT_COLORS = [
  { stroke: "stroke-black dark:stroke-white", bg: "bg-black dark:bg-white" },
  { stroke: "stroke-zinc-400 dark:stroke-zinc-500", bg: "bg-zinc-400 dark:bg-zinc-500" },
  { stroke: "stroke-zinc-300 dark:stroke-zinc-600", bg: "bg-zinc-300 dark:bg-zinc-600" },
  { stroke: "stroke-zinc-200 dark:stroke-zinc-700", bg: "bg-zinc-200 dark:bg-zinc-700" },
];

export default function DonutChart({ segments }: { segments: { label: string; value: number }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const size = 120;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <div
        className="size-[120px] rounded-full border-[16px] border-black/5 dark:border-white/10"
        aria-hidden="true"
      />
    );
  }

  // Pure running-offset computation (reduce into a fresh array) rather than
  // mutating a captured `let` across the .map() below — the latter trips
  // react-hooks/immutability since reassigning a closed-over variable during
  // render breaks the compiler's purity assumption, even though the result
  // here is deterministic.
  const withOffsets = segments.reduce<{ label: string; value: number; dash: number; offset: number }[]>(
    (acc, seg) => {
      const dash = (seg.value / total) * circumference;
      const priorEnd = acc.length > 0 ? -acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
      return [...acc, { ...seg, dash, offset: -priorEnd }];
    },
    [],
  );

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-32 -rotate-90" role="img">
      {withOffsets.map((seg, i) => {
        const { dash, offset } = seg;
        return (
          <circle
            key={seg.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={offset}
            className={SEGMENT_COLORS[i % SEGMENT_COLORS.length].stroke}
          >
            <title>
              {seg.label}: {seg.value}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}
