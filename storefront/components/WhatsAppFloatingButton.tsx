"use client";

import { MessageCircle } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { buildWhatsAppUrl, shouldShowWhatsAppButton } from "@/lib/whatsapp-button";

// Persistent bottom-corner button — reuses shop.whatsappCountryCode/
// whatsappNumber (Business Information). Visibility: the theme builder's
// globalSettings.floatingElements.whatsapp.enabled wins when set (Phase 6);
// otherwise the legacy shop.whatsappFloatingButtonEnabled toggle (Store
// Configuration) still applies — no behaviour change for a shop that never
// touches the new category.
export default function WhatsAppFloatingButton() {
  const { shop, themeConfig } = useShop();
  const wa = themeConfig?.globalSettings.floatingElements?.whatsapp;
  if (!shouldShowWhatsAppButton(shop, wa?.enabled)) return null;

  const url = buildWhatsAppUrl(shop!.whatsappCountryCode, shop!.whatsappNumber);
  if (!url) return null;

  const posClass = wa?.position === "bottom_left" ? "bottom-5 left-5" : "bottom-5 right-5";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className={`fixed ${posClass} z-40 flex items-center justify-center size-14 rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 theme-hover-zoom`}
    >
      <MessageCircle className="size-7" fill="currentColor" strokeWidth={0} />
    </a>
  );
}
