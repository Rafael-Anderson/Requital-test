// Format checks for the analytics / ad-pixel ids the backend hands us.
//
// Mirrors backend/src/shop-analytics/analytics-ids.ts by hand (the two apps share
// no code). The backend already validates on save; this is the second lock: every
// id here ends up inside a third-party script URL or inline bootstrap, so a value
// that does not match is dropped rather than injected, whatever the API said.
export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,14}$/;
export const META_PIXEL_ID = /^\d{6,20}$/;
export const TIKTOK_PIXEL_ID = /^[A-Z0-9]{8,32}$/;
export const SNAP_PIXEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GOOGLE_ADS_CONVERSION_ID = /^AW-\d{6,14}$/;
export const GOOGLE_ADS_CONVERSION_LABEL = /^[A-Za-z0-9_-]{6,64}$/;

export interface PublicAnalyticsConfig {
  ga4MeasurementId?: string;
  metaPixelId?: string;
  tiktokPixelId?: string;
  snapPixelId?: string;
  googleAdsConversionId?: string;
  googleAdsConversionLabel?: string;
}

function ok(value: unknown, re: RegExp): string | undefined {
  return typeof value === "string" && re.test(value) ? value : undefined;
}

// Whatever the API returned, reduced to the ids that are well-formed. Never
// throws; null/garbage in gives {} out (nothing loads).
export function sanitizeAnalyticsConfig(raw: unknown): PublicAnalyticsConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: PublicAnalyticsConfig = {};
  const ga4 = ok(r.ga4MeasurementId, GA4_MEASUREMENT_ID);
  const meta = ok(r.metaPixelId, META_PIXEL_ID);
  const tiktok = ok(r.tiktokPixelId, TIKTOK_PIXEL_ID);
  const snap = ok(r.snapPixelId, SNAP_PIXEL_ID);
  const adsId = ok(r.googleAdsConversionId, GOOGLE_ADS_CONVERSION_ID);
  const adsLabel = ok(r.googleAdsConversionLabel, GOOGLE_ADS_CONVERSION_LABEL);
  if (ga4) out.ga4MeasurementId = ga4;
  if (meta) out.metaPixelId = meta;
  if (tiktok) out.tiktokPixelId = tiktok;
  if (snap) out.snapPixelId = snap;
  if (adsId) {
    out.googleAdsConversionId = adsId;
    if (adsLabel) out.googleAdsConversionLabel = adsLabel;
  }
  return out;
}
