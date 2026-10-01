// Client-side format hints for the analytics ids on Integrations > Analytics &
// Pixels. Mirrors backend/src/shop-analytics/analytics-ids.ts by hand (the apps
// share no code); the backend is the real validation and always re-checks.
export const ANALYTICS_ID_PATTERNS = {
  ga4MeasurementId: { re: /^G-[A-Z0-9]{4,14}$/, hint: "Looks like G-XXXXXXXXXX" },
  metaPixelId: { re: /^\d{6,20}$/, hint: "Digits only" },
  metaTestEventCode: { re: /^TEST[A-Za-z0-9]{1,20}$/, hint: "Looks like TEST12345" },
  tiktokPixelId: { re: /^[A-Z0-9]{8,32}$/, hint: "Upper-case letters and digits" },
  snapPixelId: {
    re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    hint: "A UUID, like 1b2c3d4e-0000-4000-8000-123456789abc",
  },
  googleAdsConversionId: { re: /^AW-\d{6,14}$/, hint: "Looks like AW-123456789" },
  googleAdsConversionLabel: { re: /^[A-Za-z0-9_-]{6,64}$/, hint: "Letters, digits, - and _" },
} as const;

export type AnalyticsIdField = keyof typeof ANALYTICS_ID_PATTERNS;

// "" is valid (it means "clear this field"); anything else must match.
export function analyticsIdError(field: AnalyticsIdField, value: string): string | undefined {
  const v = value.trim();
  if (v === "") return undefined;
  return ANALYTICS_ID_PATTERNS[field].re.test(v) ? undefined : ANALYTICS_ID_PATTERNS[field].hint;
}
