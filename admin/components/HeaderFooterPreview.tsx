import { ShoppingCart, User } from "lucide-react";
import { THEME_COLOR_DEFAULTS } from "@/lib/types";

// Static illustration of the storefront's header/footer chrome, reflecting
// live in-progress edits from Site Settings (logo, announcement bar text/
// toggles, footer description/logo) plus the shop's already-saved
// Appearance Color + Advanced-tab layout/density choices — same "small
// static sketch, not a live-rendered iframe" rule as PresetThumbnails,
// just assembled from real current values instead of a fixed mockup, since
// merchants kept asking "what does this actually look like" without saving
// and checking the real storefront first.
export default function HeaderFooterPreview({
  logoPreview,
  shopName,
  notificationText,
  announcementBarEnabled,
  announcementBarScrolling,
  footerDescription,
  footerLogoPreview,
  colors,
}: {
  logoPreview: string | null;
  shopName: string;
  notificationText: string[];
  announcementBarEnabled: boolean;
  announcementBarScrolling: boolean;
  footerDescription: string;
  footerLogoPreview: string | null;
  colors: Record<string, string>;
}) {
  const headerBg = colors.headerBackgroundColor ?? THEME_COLOR_DEFAULTS.headerBackgroundColor;
  const headerFg = colors.headerTextColor ?? THEME_COLOR_DEFAULTS.headerTextColor;
  const footerBg = colors.footerBackgroundColor ?? THEME_COLOR_DEFAULTS.footerBackgroundColor;
  const footerFg = colors.footerTextColor ?? THEME_COLOR_DEFAULTS.footerTextColor;
  const barText = notificationText.join("   •   ");

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
      {announcementBarEnabled && barText && (
        <div
          className={`text-[10px] text-center py-1 px-3 whitespace-nowrap overflow-hidden ${announcementBarScrolling ? "text-ellipsis" : ""}`}
          style={{ background: "#069494", color: "#ffffff" }}
        >
          {barText}
        </div>
      )}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: headerBg, color: headerFg }}
      >
        {logoPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoPreview} alt="" className="h-6 max-w-28 object-contain" />
        ) : (
          <span className="text-sm font-semibold">{shopName || "Your Shop"}</span>
        )}
        <div className="flex items-center gap-2 opacity-70">
          <User className="size-4" />
          <ShoppingCart className="size-4" />
        </div>
      </div>

      <div className="p-3 bg-white dark:bg-zinc-900 text-center">
        <p className="text-[10px] text-zinc-400">Page content…</p>
      </div>

      <div className="px-4 py-4" style={{ background: footerBg, color: footerFg }}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {footerLogoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={footerLogoPreview} alt="" className="h-5 max-w-24 object-contain mb-1" />
            ) : (
              <p className="text-xs font-semibold">{shopName || "Your Shop"}</p>
            )}
            {footerDescription && <p className="text-[10px] opacity-70 truncate max-w-[200px]">{footerDescription}</p>}
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-white/10 text-[9px] opacity-60">
          © {new Date().getFullYear()} {shopName || "Your Shop"}. All Rights Reserved
        </div>
      </div>
    </div>
  );
}
