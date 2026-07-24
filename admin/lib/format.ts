const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(dateStr: string): string {
  const diffMin = Math.round((Date.now() - new Date(dateStr).getTime()) / 60_000);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(-diffHr, "hour");
  return rtf.format(-Math.round(diffHr / 24), "day");
}
