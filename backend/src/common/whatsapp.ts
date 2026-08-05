// STUB: used when a shop hasn't configured Meta WhatsApp Cloud API
// credentials yet (see WhatsAppSettingsService/OrderNotificationsService) —
// same spirit as email.ts's sendEmailStub, logs instead of silently
// no-op'ing so an unconfigured shop's "missing" notification is still
// visible somewhere. Never blocks the caller; matches sendEmailStub's shape.
//
// Deliberately still a raw console.log — same reasoning and same
// allowlist entry as sendEmailStub's own comment (order-notifications.e2e-
// spec.ts spies on console.log for both stubs via the same logSpy).
export function sendWhatsAppStub(to: string, bodyText: string): void {
  console.log(`[whatsapp:stub] to=${to}\n${bodyText}`);
}
