import { IsOptional, Matches } from 'class-validator';
import {
  GA4_MEASUREMENT_ID,
  GOOGLE_ADS_CONVERSION_ID,
  GOOGLE_ADS_CONVERSION_LABEL,
  META_CAPI_TOKEN,
  META_PIXEL_ID,
  META_TEST_EVENT_CODE,
  SNAP_CAPI_TOKEN,
  SNAP_PIXEL_ID,
  TIKTOK_EVENTS_TOKEN,
  TIKTOK_PIXEL_ID,
} from '../analytics-ids';

// Partial update: an absent key is left alone, an explicit `null` clears it.
// `@IsOptional()` skips validation for both undefined and null, which is exactly
// that contract. An empty string is NOT a clear (it fails the pattern); the
// admin form sends null for an emptied field.
export class UpdateAnalyticsSettingsDto {
  @IsOptional()
  @Matches(GA4_MEASUREMENT_ID, {
    message: 'ga4MeasurementId must look like G-XXXXXXXXXX',
  })
  ga4MeasurementId?: string | null;

  @IsOptional()
  @Matches(META_PIXEL_ID, {
    message: 'metaPixelId must be the numeric Meta pixel id',
  })
  metaPixelId?: string | null;

  // WRITE-ONLY. Accepted here, encrypted at rest, never returned by any API.
  @IsOptional()
  @Matches(META_CAPI_TOKEN, {
    message: 'metaCapiToken does not look like a Meta access token',
  })
  metaCapiToken?: string | null;

  @IsOptional()
  @Matches(META_TEST_EVENT_CODE, {
    message: 'metaTestEventCode must look like TEST12345',
  })
  metaTestEventCode?: string | null;

  @IsOptional()
  @Matches(TIKTOK_PIXEL_ID, {
    message: 'tiktokPixelId must be the TikTok pixel code (upper-case letters and digits)',
  })
  tiktokPixelId?: string | null;

  // WRITE-ONLY, like metaCapiToken.
  @IsOptional()
  @Matches(TIKTOK_EVENTS_TOKEN, {
    message: 'tiktokEventsToken does not look like a TikTok Events API access token',
  })
  tiktokEventsToken?: string | null;

  @IsOptional()
  @Matches(SNAP_CAPI_TOKEN, {
    message: 'snapCapiToken does not look like a Snap Conversions API token',
  })
  snapCapiToken?: string | null;

  @IsOptional()
  @Matches(SNAP_PIXEL_ID, {
    message: 'snapPixelId must be the Snap pixel id (a UUID)',
  })
  snapPixelId?: string | null;

  @IsOptional()
  @Matches(GOOGLE_ADS_CONVERSION_ID, {
    message: 'googleAdsConversionId must look like AW-123456789',
  })
  googleAdsConversionId?: string | null;

  @IsOptional()
  @Matches(GOOGLE_ADS_CONVERSION_LABEL, {
    message: 'googleAdsConversionLabel contains invalid characters',
  })
  googleAdsConversionLabel?: string | null;
}
