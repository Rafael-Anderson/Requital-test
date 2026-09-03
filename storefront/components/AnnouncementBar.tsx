"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { parseNotificationMessages } from "@/lib/notification-text";
import { announcementDismissKey, useAnnouncementRotation } from "@/lib/announcement-rotation";
import type { AnnouncementBarConfig } from "@/lib/theme-config-types";

// Slim bar above the header, persistent chrome on every page.
//
// Phase 5 (TBE3): a merchant who configures the theme builder's persistent
// announcement bar (`header.settings.announcementBar`) gets the themed bar
// below — multiple rotating messages with a crossfade, optional marquee,
// optional dismiss-with-X (remembered per shop + per message set in
// localStorage). Every shop that HASN'T touched it falls back to the legacy
// `shop.announcementBarEnabled` / `shop.notificationText` bar, unchanged —
// bg-accent/text-accent-foreground, the same theme-derived, WCAG-guarded
// pairing every other themed element resolves to.
export default function AnnouncementBar() {
  const { shop, shopSlug, themeConfig } = useShop();

  const raw = (themeConfig?.header.settings as { announcementBar?: unknown } | undefined)?.announcementBar;
  const cfg = normalizeConfig(raw);
  if (cfg) return <ThemedAnnouncementBar cfg={cfg} shopSlug={shopSlug} />;

  // --- Legacy path (unchanged) ---
  const messages = parseNotificationMessages(shop?.notificationText);
  if (!shop?.announcementBarEnabled || messages.length === 0) return null;
  const text = messages.join("   •   ");

  if (shop.announcementBarScrolling) {
    return (
      <div className="overflow-hidden whitespace-nowrap bg-accent text-accent-foreground text-xs py-1.5">
        <div className="inline-block marquee-track">
          <span className="px-4">{text}</span>
          <span className="px-4" aria-hidden="true">
            {text}
          </span>
        </div>
      </div>
    );
  }

  return <div className="bg-accent text-accent-foreground text-xs text-center py-1.5 px-4">{text}</div>;
}

function normalizeConfig(raw: unknown): (AnnouncementBarConfig & { messages: string[] }) | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as AnnouncementBarConfig;
  if (!c.enabled) return null;
  const messages = Array.isArray(c.messages) ? c.messages.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim()) : [];
  if (messages.length === 0) return null;
  return { ...c, messages };
}

function ThemedAnnouncementBar({
  cfg,
  shopSlug,
}: {
  cfg: AnnouncementBarConfig & { messages: string[] };
  shopSlug: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const key = announcementDismissKey(shopSlug, cfg.messages);

  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "1") setDismissed(true);
    } catch {
      // blocked/corrupt storage — just show the bar
    }
    setLoaded(true);
  }, [key]);

  const { rotating, index, faded } = useAnnouncementRotation(cfg.messages, !cfg.scrolling, cfg.speed);

  if (!loaded || dismissed) return null;

  const style = {
    background: cfg.background || undefined,
    color: cfg.textColor || undefined,
  };
  const useAccentFallback = !cfg.background && !cfg.textColor;
  const joined = cfg.messages.join("   •   ");
  const displayText = cfg.scrolling || !rotating ? joined : cfg.messages[index];

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // still dismissed for this page view
    }
  }

  const dismissBtn = cfg.dismissible ? (
    <button
      type="button"
      onClick={dismiss}
      aria-label="Dismiss announcement"
      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 opacity-70 hover:opacity-100"
    >
      <X className="size-3.5" />
    </button>
  ) : null;

  if (cfg.scrolling) {
    return (
      <div
        className={`relative overflow-hidden whitespace-nowrap text-xs py-1.5 ${useAccentFallback ? "bg-accent text-accent-foreground" : ""}`}
        style={style}
      >
        <div className="inline-block marquee-track">
          <span className="px-4">{displayText}</span>
          <span className="px-4" aria-hidden="true">
            {displayText}
          </span>
        </div>
        {dismissBtn}
      </div>
    );
  }

  return (
    <div
      className={`relative text-xs text-center py-1.5 px-8 ${useAccentFallback ? "bg-accent text-accent-foreground" : ""}`}
      style={style}
    >
      <span style={rotating ? { transition: "opacity var(--motion-duration-base, 0.4s)", opacity: faded ? 0 : 1 } : undefined}>{displayText}</span>
      {dismissBtn}
    </div>
  );
}
