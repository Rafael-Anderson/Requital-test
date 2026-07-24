"use client";

import { useState } from "react";
import type { DailyRevenuePoint } from "@/lib/types";

// Hand-rolled SVG line/area chart — same reasoning as the old RevenueChart
// bar chart it replaces: a charting library is overkill for one chart, this
// skips the dependency. Unlike that one (which only had a native <title>
// tooltip), this tracks a hovered/clicked point so a real positioned tooltip
// can show that day's date + revenue.
function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function SalesOverviewChart({ data }: { data: DailyRevenuePoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  const width = 720;
  const height = 220;
  const paddingTop = 16;
  const paddingBottom = 24;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const plotHeight = height - paddingTop - paddingBottom;
  const colWidth = data.length > 1 ? width / (data.length - 1) : width;

  const points = data.map((d, i) => ({
    x: data.length > 1 ? i * colWidth : width / 2,
    y: paddingTop + plotHeight - (d.revenue / max) * plotHeight,
    date: d.date,
    revenue: d.revenue,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z`
      : "";

  const active = activeIndex !== null ? points[activeIndex] : null;

  if (data.length === 0) {
    return <p className="text-sm text-zinc-400 text-center py-16">No revenue data for this range.</p>;
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-56"
        role="img"
        onMouseLeave={() => !pinned && setActiveIndex(null)}
      >
        {points.length > 1 && <path d={areaPath} className="fill-black/10 dark:fill-white/10" />}
        <path d={linePath} fill="none" strokeWidth={2} className="stroke-black dark:stroke-white" />
        {active && (
          <line
            x1={active.x}
            y1={paddingTop}
            x2={active.x}
            y2={height - paddingBottom}
            strokeDasharray="3 3"
            className="stroke-black/15 dark:stroke-white/15"
          />
        )}
        {points.map((p, i) => (
          <g key={p.date}>
            {/* wide invisible hit target per day — easier to hover/tap than the dot itself */}
            <rect
              x={p.x - colWidth / 2}
              y={0}
              width={colWidth}
              height={height}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => {
                setPinned((wasPinned) => !(activeIndex === i && wasPinned));
                setActiveIndex(i);
              }}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={activeIndex === i ? 4 : 2.5}
              className={activeIndex === i ? "fill-black dark:fill-white" : "fill-black/40 dark:fill-white/40"}
            />
          </g>
        ))}
      </svg>
      {active && (
        <div
          className="absolute pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs shadow-lg"
          style={{ left: `${(active.x / width) * 100}%`, top: `${(active.y / height) * 100}%` }}
        >
          <div className="font-medium">{formatDateLabel(active.date)}</div>
          <div className="text-zinc-500">{active.revenue.toFixed(2)} AED</div>
        </div>
      )}
    </div>
  );
}
