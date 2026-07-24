"use client";

import { WEEKDAYS, type BusinessHours, type Weekday } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/business-hours";
import Checkbox from "@/components/ui/Checkbox";

export default function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: BusinessHours;
  onChange: (next: BusinessHours) => void;
}) {
  function updateDay(day: Weekday, patch: Partial<BusinessHours[Weekday]>) {
    onChange({ ...value, [day]: { ...value[day], ...patch } });
  }

  return (
    <div className="space-y-1.5">
      {WEEKDAYS.map((day) => (
        <div key={day} className="flex items-center gap-3">
          <span className="w-24 text-sm text-zinc-600 dark:text-zinc-400 shrink-0">
            {WEEKDAY_LABELS[day]}
          </span>
          {value[day].closed ? (
            <span className="text-sm text-zinc-400 flex-1">Closed</span>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="time"
                value={value[day].open}
                onChange={(e) => updateDay(day, { open: e.target.value })}
                className="h-8 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-sm outline-none transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
              />
              <span className="text-zinc-400 text-sm">–</span>
              <input
                type="time"
                value={value[day].close}
                onChange={(e) => updateDay(day, { close: e.target.value })}
                className="h-8 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-sm outline-none transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
              />
            </div>
          )}
          <Checkbox
            label="Closed"
            checked={value[day].closed}
            onChange={(e) => updateDay(day, { closed: e.target.checked })}
          />
        </div>
      ))}
    </div>
  );
}
