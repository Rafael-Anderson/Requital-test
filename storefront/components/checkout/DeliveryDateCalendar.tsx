"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function parseDateStr(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

// Replaces the native <input type="date"> with an inline month grid — no
// date library installed in this app, and a month grid is a handful of Date
// calls, not worth adding one for. `isDateGrayedOut` is the same-day/
// next-day acceptance-window check (lib/slots.ts's isDateBlocked) applied
// per cell rather than only to the currently-selected date — grayed, not
// disabled, matching the existing behavior of allowing the pick but warning
// (the warning copy itself still lives in the parent, unchanged).
export default function DeliveryDateCalendar({
  value,
  onChange,
  minDate,
  isDateGrayedOut,
}: {
  value: string;
  onChange: (date: string) => void;
  minDate: string;
  isDateGrayedOut?: (date: string) => boolean;
}) {
  const today = useMemo(() => parseDateStr(minDate), [minDate]);
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(value ? parseDateStr(value) : today),
  );
  const [focusedDate, setFocusedDate] = useState(value || minDate);
  const gridRef = useRef<HTMLDivElement>(null);

  const isCurrentMonth =
    viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() === today.getMonth();

  const cells = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    return out;
  }, [viewMonth]);

  function goToMonth(delta: number) {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  function selectDate(d: Date) {
    const str = toDateStr(d);
    onChange(str);
    setFocusedDate(str);
  }

  function moveFocus(days: number) {
    const current = parseDateStr(focusedDate);
    current.setDate(current.getDate() + days);
    if (current < today) return;
    const str = toDateStr(current);
    setFocusedDate(str);
    if (current.getMonth() !== viewMonth.getMonth() || current.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(startOfMonth(current));
    }
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${str}"]`)?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(7);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-7);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectDate(parseDateStr(focusedDate));
        break;
    }
  }

  return (
    <div className="rounded-lg border border-stroke p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => goToMonth(-1)}
          disabled={isCurrentMonth}
          aria-label="Previous month"
          className="p-1 rounded-md hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-medium">
          {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => goToMonth(1)}
          aria-label="Next month"
          className="p-1 rounded-md hover:bg-black/5 cursor-pointer"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} className="text-center text-xs text-zinc-400">
            {w}
          </div>
        ))}
      </div>
      <div ref={gridRef} role="grid" onKeyDown={handleKeyDown} className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const dateStr = toDateStr(d);
          const isPast = d < today;
          const isToday = dateStr === toDateStr(today);
          const isSelected = dateStr === value;
          const isGrayed = !isPast && !isSelected && isDateGrayedOut?.(dateStr);
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              data-date={dateStr}
              disabled={isPast}
              tabIndex={dateStr === focusedDate ? 0 : -1}
              onClick={() => selectDate(d)}
              onFocus={() => setFocusedDate(dateStr)}
              aria-selected={isSelected}
              aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              className={`aspect-square rounded-md text-sm cursor-pointer transition-colors flex items-center justify-center ${
                isSelected
                  ? "bg-accent text-accent-foreground font-medium"
                  : isPast
                    ? "text-zinc-300 cursor-not-allowed"
                    : isGrayed
                      ? "text-zinc-400"
                      : isToday
                        ? "ring-1 ring-accent text-foreground hover:bg-black/5"
                        : "text-foreground hover:bg-black/5"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
