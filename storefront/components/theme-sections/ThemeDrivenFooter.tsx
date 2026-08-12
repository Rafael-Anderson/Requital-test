import type { CSSProperties } from "react";
import type { Shop } from "@/lib/types";
import type { HeaderFooterConfig } from "@/lib/theme-config-types";

// Global chrome — pinned to every page, same reasoning as ThemeDrivenHeader.
// Fixed single-row layout for now (no columns editor/social links in this
// system yet — those stay legacy-Footer-only concerns for now).
export default function ThemeDrivenFooter({ shop, config }: { shop: Shop; config: HeaderFooterConfig }) {
  const copyrightText =
    typeof config.settings.copyrightText === "string" && config.settings.copyrightText
      ? config.settings.copyrightText
      : `© ${new Date().getFullYear()} ${shop.displayName ?? shop.name}. All Rights Reserved`;

  const background = config.settings.background as Record<string, unknown> | undefined;
  const style: CSSProperties = { color: "var(--color-footer-fg)" };
  style.background =
    background?.type === "solid" && typeof background.color === "string" ? background.color : "var(--color-footer-bg)";

  return (
    <footer style={style} className="py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-xs opacity-80">
        <p>{copyrightText}</p>
      </div>
    </footer>
  );
}
