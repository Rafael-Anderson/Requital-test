// One entry per queued operation. Keep payloads plain JSON-serializable data
// (no class instances, no Decimal/Date objects) since they round-trip
// through the `job.payload` JSON column.
export type JobType =
  | 'send_email'
  | 'send_merchant_whatsapp_alert'
  | 'process_slider_webhook'
  | 'compute_daily_rollup'
  | 'recompute_customer_metrics'
  | 'send_conversion_event';

export interface SendEmailJobPayload {
  to: string;
  subject: string;
  bodyText: string;
  fromName?: string;
  html?: string;
}

// Platform-owned WhatsApp new-order alert to the merchant's own outlet
// (contrast the customer-facing send_email/customer WhatsApp channels) —
// see common/whatsapp.ts's sendPlatformWhatsAppAlertOrThrow.
export interface SendMerchantWhatsAppAlertJobPayload {
  to: string;
  body: string;
  orderId: number;
}

// Slider's webhook receiver (SliderWebhookController) enqueues one of these
// per delivery so it can respond 2xx immediately without doing the real
// DB/order work inline — see SliderWebhookJobHandler. shopId is included
// even though it's also the job's own column, since job handlers only ever
// receive the payload (see JobsWorkerService.registerHandler), not the row
// itself.
// providedToken carries whatever the shop's own optional webhook-token
// header check needs to compare against — resolved (and enforced) inside
// the handler, not the controller, so an invalid token still lands as a
// normal (silently-dropped, not retried) job rather than a DB read on the
// hot webhook-response path.
export interface ProcessSliderWebhookJobPayload {
  shopId: number;
  orderId: number;
  sliderOrderNumber: number;
  status: string;
  trackingLink: string | null;
  estimatedDeliveryTime: string | number | null;
  driverInfo: {
    name?: string;
    phone_number?: string;
    latitude?: number;
    longitude?: number;
  } | null;
}

// ANL-1's nightly rollup, one job per shop per day. `date` is a local
// 'YYYY-MM-DD' key in the SHOP's timezone, not a UTC instant - a rollup is a
// question about a merchant's trading day, and the two disagree for four hours
// every day in Asia/Dubai.
//
// The idempotency key is derived from shopId + date (see
// AnalyticsRollupService.enqueueDay), so re-enqueueing a day that is already
// queued is a no-op at the job table's UNIQUE index. The handler is separately
// idempotent by delete-then-insert, so a RETRY of an already-partly-run job
// cannot double-count either - the two mechanisms guard different failures.
export interface ComputeDailyRollupJobPayload {
  shopId: number;
  date: string;
}

// Customer metrics are a whole-history snapshot rather than a daily series, so
// this recomputes a shop's set wholesale instead of taking a date.
export interface RecomputeCustomerMetricsJobPayload {
  shopId: number;
}

// MKT-4: one server-side conversion event (Meta Conversions API) for one order.
// Deliberately carries NO secret and NO personal data: the access token and the
// customer's contact details are resolved by the handler at send time, from the
// shop's encrypted config and the order row, so neither ever sits in the job
// table (or in a dead-letter view / error message). What IS captured here is the
// moment-of-event data - when it happened and what the order was worth - so a
// retry hours later still reports the original event.
export interface SendConversionEventJobPayload {
  platform: 'meta';
  shopId: number;
  orderId: number;
  eventId: string;
  // Unix seconds, taken when the order was created / paid.
  eventTime: number;
  // Major units in the order's own currency, as a decimal string.
  value: string;
  currency: string;
}

export type JobPayload =
  | SendEmailJobPayload
  | SendMerchantWhatsAppAlertJobPayload
  | ProcessSliderWebhookJobPayload
  | ComputeDailyRollupJobPayload
  | RecomputeCustomerMetricsJobPayload
  | SendConversionEventJobPayload;
