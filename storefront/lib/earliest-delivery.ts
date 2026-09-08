// Pure — the "Earliest Delivery: Today / Tomorrow" label from a shop-level
// same-day cutoff (stakeholder #13). Evaluated in the SHOP's timezone, not
// the browser's — same reasoning as the checkout time-slot cutoff
// (lib/slots.ts) and the product-is-new expiry. Returns null when the shop
// has not configured a cutoff (the feature is off) or the timezone is
// unusable — the caller then renders no line.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function resolveEarliestDeliveryLabel(
  cutoffHHMM: string | null | undefined,
  timezone: string | undefined,
  now: Date = new Date(),
): "Today" | "Tomorrow" | null {
  if (!cutoffHHMM || !HHMM.test(cutoffHHMM)) return null;
  const [ch, cm] = cutoffHHMM.split(":").map(Number);
  const cutoffMinutes = ch * 60 + cm;

  let nowMinutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "Asia/Dubai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    // Some engines emit "24" for midnight with hour12:false — normalise.
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    nowMinutes = h * 60 + m;
  } catch {
    return null; // invalid timezone string — fail closed, show nothing
  }

  return nowMinutes <= cutoffMinutes ? "Today" : "Tomorrow";
}
