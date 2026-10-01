// Format checks for every merchant-supplied analytics identifier.
//
// These are not cosmetic. Each value ends up inside a third-party script URL or
// an inline bootstrap on every storefront page, so an unvalidated string here
// would be stored XSS against every shopper of that shop. Strict allow-list
// patterns (no quotes, no slashes, no whitespace) make that structurally
// impossible, and the storefront re-checks the same patterns before it injects
// anything (storefront/lib/analytics-ids.ts mirrors this file by hand: the two
// apps share no code).
export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,14}$/;
export const META_PIXEL_ID = /^\d{6,20}$/;
export const TIKTOK_PIXEL_ID = /^[A-Z0-9]{8,32}$/;
// Snap pixel ids are UUIDs.
export const SNAP_PIXEL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GOOGLE_ADS_CONVERSION_ID = /^AW-\d{6,14}$/;
export const GOOGLE_ADS_CONVERSION_LABEL = /^[A-Za-z0-9_-]{6,64}$/;
// Long opaque alphanumeric token (Meta system-user / pixel tokens). The pattern
// only bounds the alphabet and length; it can say nothing about validity.
export const META_CAPI_TOKEN = /^[A-Za-z0-9_|.-]{20,512}$/;
export const META_TEST_EVENT_CODE = /^TEST[A-Za-z0-9]{1,20}$/;
