import { WEEKDAYS, type BusinessHours, type Weekday } from "./types";

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function defaultBusinessHours(): BusinessHours {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, { open: "09:00", close: "18:00", closed: false }]),
  ) as BusinessHours;
}

// Accepts a partial hours object (Shop stores it as a JSON string; Outlet
// stores it as native Json, so raw arrives pre-parsed) and fills in defaults
// for any day that's missing.
export function mergeBusinessHours(
  raw: Partial<BusinessHours> | string | null | undefined,
): BusinessHours {
  let parsed: Partial<BusinessHours> = {};
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw) {
    parsed = raw;
  }
  return { ...defaultBusinessHours(), ...parsed };
}
