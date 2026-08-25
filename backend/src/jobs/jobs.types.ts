// One entry per queued operation. Keep payloads plain JSON-serializable data
// (no class instances, no Decimal/Date objects) since they round-trip
// through the `job.payload` JSON column.
export type JobType =
  | 'send_email'
  | 'send_merchant_whatsapp_alert'
  | 'process_slider_webhook';

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
  providedToken: string | null;
}

export type JobPayload =
  | SendEmailJobPayload
  | SendMerchantWhatsAppAlertJobPayload
  | ProcessSliderWebhookJobPayload;
