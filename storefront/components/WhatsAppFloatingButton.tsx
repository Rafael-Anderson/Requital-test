"use client";

import { MessageCircle } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { buildWhatsAppUrl, shouldShowWhatsAppButton } from "@/lib/whatsapp-button";

// Persistent bottom-right button — reuses shop.whatsappCountryCode/
// whatsappNumber (Business Information) and shop.whatsappFloatingButtonEnabled
// (Store Configuration), both of which already existed with a real admin
// toggle/inputs but no storefront element consuming them (confirmed via
// search before building this) — no new schema field.
export default function WhatsAppFloatingButton() {
  const { shop } = useShop();
  if (!shouldShowWhatsAppButton(shop)) return null;

  const url = buildWhatsAppUrl(shop!.whatsappCountryCode, shop!.whatsappNumber);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex items-center justify-center size-14 rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 hover:scale-105 transition-transform"
    >
      <MessageCircle className="size-7" fill="currentColor" strokeWidth={0} />
    </a>
  );
}
