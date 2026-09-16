"use client";

// A calendar-grid + hour/minute date-time picker, for scheduling a Slider
// delivery (ManageDeliveryModal.tsx) — no existing date-time picker in this
// codebase to reuse (only plain <input type="date">/"time"> elsewhere), so
// this is a new small component. Popover, not a nested Modal — Modal.tsx's
// Escape listener and body-scroll-lock are both global
// (`document.addEventListener`), so a second Modal instance inside a modal
// would double-handle Escape and fight over document.body.style.overflow.
// Reuses DropdownMenu.tsx/Combobox.tsx's existing open/close/click-outside/
// escape pattern instead (rootRef + mousedown listener) rather than
// introducing a different one.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import Button from "./Button";
import Select from "./Select";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "09/16/2026, 15:58" — matches the reference format.
export function formatDateTimeDisplay(d: Date): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBeforeToday(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cmp = new Date(d);
  cmp.setHours(0, 0, 0, 0);
  return cmp.getTime() < today.getTime();
}

function buildCalendarCells(viewMonth: Date): (Date | null)[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  return cells;
}

export default function DateTimePicker({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const parsedValue = value ? new Date(value) : null;
  const [viewMonth, setViewMonth] = useState(() => parsedValue ?? new Date());
  const [pendingDate, setPendingDate] = useState<Date | null>(parsedValue);
  const [pendingHour, setPendingHour] = useState(parsedValue ? parsedValue.getHours() : new Date().getHours());
  const [pendingMinute, setPendingMinute] = useState(parsedValue ? parsedValue.getMinutes() : new Date().getMinutes());

  useEffect(() => {
    if (!open) return;
    // Re-seed the pending picks from the committed value every time the
    // popover opens, so a Cancel on a previous open never leaks a stale pick
    // into the next one.
    const current = value ? new Date(value) : null;
    setPendingDate(current);
    setViewMonth(current ?? new Date());
    setPendingHour(current ? current.getHours() : new Date().getHours());
    setPendingMinute(current ? current.getMinutes() : new Date().getMinutes());

    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function commitSelection() {
    if (!pendingDate) return;
    const result = new Date(pendingDate);
    result.setHours(pendingHour, pendingMinute, 0, 0);
    onChange(result.toISOString());
    setOpen(false);
  }

  const cells = buildCalendarCells(viewMonth);

  return (
    <div>
      {label && <label className="text-[13px] font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">{label}</label>}
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        >
          <Clock className="size-4 shrink-0 text-text-faint" />
          <span className={parsedValue ? "" : "text-text-faint"}>
            {parsedValue ? formatDateTimeDisplay(parsedValue) : "Select date & time"}
          </span>
        </button>

        {open && (
          <div className="popover-in absolute left-0 top-full z-50 mt-1.5 w-72 rounded-[10px] border border-border dark:border-white/10 bg-surface dark:bg-zinc-900 shadow-lg shadow-black/10 p-3">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-medium">
                {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center text-xs text-text-faint mb-1">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center text-sm mb-3">
              {cells.map((day, i) => {
                if (!day) return <div key={i} />;
                const disabled = isBeforeToday(day);
                const selected = pendingDate && isSameDay(day, pendingDate);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPendingDate(day)}
                    className={`size-8 mx-auto rounded-full transition-colors ${
                      disabled
                        ? "text-text-faint opacity-40 cursor-not-allowed"
                        : selected
                          ? "bg-accent text-white cursor-pointer"
                          : "hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 mb-3">
              <Select
                aria-label="Hour"
                value={pendingHour}
                onChange={(e) => setPendingHour(Number(e.target.value))}
                className="!h-8 !py-1"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {pad2(h)}
                  </option>
                ))}
              </Select>
              <span className="text-text-faint">:</span>
              <Select
                aria-label="Minute"
                value={pendingMinute}
                onChange={(e) => setPendingMinute(Number(e.target.value))}
                className="!h-8 !py-1"
              >
                {Array.from({ length: 60 }, (_, m) => (
                  <option key={m} value={m}>
                    {pad2(m)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={commitSelection} disabled={!pendingDate}>
                Select
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
