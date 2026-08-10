import { MetaWhatsAppProvider } from '../whatsapp/providers/meta-whatsapp.provider';

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

const platformProvider = new MetaWhatsAppProvider();

// Platform-owned WhatsApp order alerts — one Requital WhatsApp Business
// account for the whole platform, not merchant-configured (contrast
// OrderNotificationsService.sendWhatsApp, which is the per-shop, bring-
// your-own-credentials customer-facing channel). Same real-vs-stub
// resolution shape as email.ts's sendEmailOrThrow: falls back to the stub
// when the platform credentials aren't configured, otherwise sends for
// real. Reuses MetaWhatsAppProvider.sendMessage directly rather than going
// through WhatsAppSettingsService, since there's no per-shop credential to
// resolve here — just env vars.
export async function sendPlatformWhatsAppAlertOrThrow(
  to: string,
  body: string,
): Promise<void> {
  const phoneNumberId = process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    sendWhatsAppStub(to, body);
    return;
  }
  await platformProvider.sendMessage({
    to,
    body,
    credentials: { phoneNumberId, accessToken },
  });
}
