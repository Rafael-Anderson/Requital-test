import type { Shop } from "./types";

// Pure (no DOM/hooks) so the visibility/URL logic is directly testable —
// same "extract the real logic, keep the component a thin wrapper" pattern
// as lib/payment-methods.ts's resolvePaymentMethods.
// `enabledOverride` (theme-builder-expansion Phase 6) — when the theme's
// globalSettings.floatingElements.whatsapp.enabled is explicitly set it wins
// over the legacy shop toggle (both directions); `undefined` ⇒ fall back to
// the legacy shop.whatsappFloatingButtonEnabled. A number is still always
// required.
export function shouldShowWhatsAppButton(
  shop: Pick<Shop, "whatsappFloatingButtonEnabled" | "whatsappNumber"> | null,
  enabledOverride?: boolean,
): boolean {
  if (!shop?.whatsappNumber) return false;
  const enabled = enabledOverride ?? !!shop.whatsappFloatingButtonEnabled;
  return enabled;
}

// Same wa.me URL construction as backend BioLinksService.resolveSocialUrl's
// whatsapp case (digits-only country code + number) — kept independent
// here since this runs client-side, not through that backend service.
export function buildWhatsAppUrl(countryCode: string | null, number: string | null, message?: string): string | null {
  const digits = `${countryCode ?? ""}${number ?? ""}`.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`;
}
