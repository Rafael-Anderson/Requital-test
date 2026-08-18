"use client";

import type { CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle } from "@/lib/theme-element-style";
import { SOCIAL_ICONS } from "@/lib/social-icons";
import ThemeImageBlock from "./ThemeImageBlock";
import type { Shop } from "@/lib/types";
import type { HeaderFooterConfig, ThemeBlock } from "@/lib/theme-config-types";

// Matches admin/lib/useThemeEditor.ts's FOOTER_CHROME_ID by hand — same
// convention as ThemeDrivenHeader.tsx's own HEADER_CHROME_ID copy.
const FOOTER_CHROME_ID = "__footer__";

interface FooterColumnSettings {
  title?: string;
  links?: { label: string; url: string }[];
}

function FooterColumn({ block, sectionId, previewMode }: { block: ThemeBlock; sectionId: string; previewMode: boolean }) {
  const settings = block.settings as FooterColumnSettings;
  const links = settings.links ?? [];
  if (!settings.title && links.length === 0) return null;
  return (
    <div>
      {settings.title && (
        <p
          className="text-sm font-semibold mb-2"
          {...editableAttrs(previewMode, { id: block.id, sectionId, type: "heading" })}
          style={resolveTextElementStyle(block.settings)}
        >
          {settings.title}
        </p>
      )}
      <ul className="space-y-1.5 text-sm opacity-80">
        {links.map((link, i) => (
          <li key={i}>
            {/* Individual links are plain array entries on this column's
                own settings.links, not separate theme blocks — there's no
                per-link id to select, so every link in a column shares the
                column's own block id (its BlockSettingsForm already edits
                the full title+links list together, which is the correct
                surface for "adjust this link" anyway). */}
            <a
              href={link.url}
              {...editableAttrs(previewMode, { id: block.id, sectionId, type: "nav_link" })}
              className="hover:underline hover:opacity-100 transition-opacity"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterSocial({ shop }: { shop: Shop }) {
  const socialEntries = Object.entries(shop.socialLinks ?? {}).filter(([, url]) => !!url) as [string, string][];
  if (socialEntries.length === 0) return null;
  return (
    <div className="flex items-center gap-3">
      {socialEntries.map(([platform, url]) => {
        const Icon = SOCIAL_ICONS[platform];
        return (
          <a
            key={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={platform}
            className="flex items-center justify-center size-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            {Icon && <Icon className="size-4" />}
          </a>
        );
      })}
    </div>
  );
}

// Global chrome — pinned to every page, same reasoning as ThemeDrivenHeader.
// Genuinely block-driven now (footer_column/footer_social/footer_copyright),
// replacing the old fixed single-row copyright-only layout — a shop that's
// never touched the builder still gets the same single copyright line via
// the backend's DEFAULT_THEME_CONFIG (one footer_copyright block).
export default function ThemeDrivenFooter({ shop, config }: { shop: Shop; config: HeaderFooterConfig }) {
  const { previewMode } = useShop();
  const blocks = [...config.blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);
  const columns = blocks.filter((b) => b.type === "footer_column");
  const socialBlock = blocks.find((b) => b.type === "footer_social");
  const copyrightBlock = blocks.find((b) => b.type === "footer_copyright");
  // Image blocks (storefront-v2 Phase 4B) — inline alongside columns/social
  // in the footer's own top content row, in their normal block order.
  const imageBlocks = blocks.filter((b) => b.type === "image");

  const copyrightText =
    copyrightBlock && typeof copyrightBlock.settings.text === "string" && copyrightBlock.settings.text
      ? copyrightBlock.settings.text
      : `© ${new Date().getFullYear()} ${shop.displayName ?? shop.name}. All Rights Reserved`;

  const background = config.settings.background as Record<string, unknown> | undefined;
  const style: CSSProperties = { color: "var(--color-footer-fg)" };
  style.background =
    background?.type === "solid" && typeof background.color === "string" ? background.color : "var(--color-footer-bg)";

  return (
    <footer style={style} className="py-10">
      <div className="mx-auto px-4 sm:px-6" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        {(columns.length > 0 || socialBlock || imageBlocks.length > 0) && (
          <div className="flex flex-wrap justify-between gap-8 pb-8 mb-6 border-b border-white/10">
            {columns.map((block) => (
              <FooterColumn key={block.id} block={block} sectionId={FOOTER_CHROME_ID} previewMode={previewMode} />
            ))}
            {socialBlock && <FooterSocial shop={shop} />}
            {imageBlocks.map((block) => (
              <ThemeImageBlock key={block.id} block={block} sectionId={FOOTER_CHROME_ID} previewMode={previewMode} />
            ))}
          </div>
        )}
        <p
          className="text-center text-xs opacity-80"
          {...(copyrightBlock
            ? editableAttrs(previewMode, { id: copyrightBlock.id, sectionId: FOOTER_CHROME_ID, type: "copyright_text" })
            : {})}
          style={copyrightBlock ? resolveTextElementStyle(copyrightBlock.settings) : undefined}
        >
          {copyrightText}
        </p>
      </div>
    </footer>
  );
}
