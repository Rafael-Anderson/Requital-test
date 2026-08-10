// One entry per queued operation. Keep payloads plain JSON-serializable data
// (no class instances, no Decimal/Date objects) since they round-trip
// through the `job.payload` JSON column.
export type JobType = 'send_email' | 'send_merchant_whatsapp_alert';

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

export type JobPayload =
  SendEmailJobPayload | SendMerchantWhatsAppAlertJobPayload;
