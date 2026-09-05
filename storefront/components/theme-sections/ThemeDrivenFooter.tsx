"use client";

import type { CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { editableAttrs } from "@/lib/editable-attrs";
import { resolveTextElementStyle } from "@/lib/theme-element-style";
import { SOCIAL_ICONS } from "@/lib/social-icons";
import { paymentBadges } from "@/lib/payment-badges";
import ThemeImageBlock from "./ThemeImageBlock";
import BackToTopButton from "@/components/BackToTopButton";
import { backgroundStyle } from "./SectionWrapper";
import type { Shop } from "@/lib/types";
import type { HeaderFooterConfig, SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

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
  const columnBlocks = blocks.filter((b) => b.type === "footer_column");
  const socialBlock = blocks.find((b) => b.type === "footer_social");
  const copyrightBlock = blocks.find((b) => b.type === "footer_copyright");
  // Image blocks (storefront-v2 Phase 4B) — inline alongside columns/social
  // in the footer's own top content row, in their normal block order.
  const imageBlocks = blocks.filter((b) => b.type === "image");

  const copyrightText =
    copyrightBlock && typeof copyrightBlock.settings.text === "string" && copyrightBlock.settings.text
      ? copyrightBlock.settings.text
      : `© ${new Date().getFullYear()} ${shop.displayName ?? shop.name}. All Rights Reserved`;

  // Bug 9 fix: was solid-only, same gap as ThemeDrivenHeader.tsx's own -
  // see backgroundStyle's comment. Default var stays for gradient/image's
  // absence (backgroundStyle returns {} when unset), a real solid/gradient/
  // image override merges on top of it.
  const style: CSSProperties = {
    color: "var(--color-footer-fg)",
    background: "var(--color-footer-bg)",
    ...backgroundStyle(config.settings.background as SectionSettings["background"]),
  };

  // C1 — settings.columns: an explicit column count renders the top content
  // row as a real CSS grid instead of flex-wrap, so a "multi-column"/"mega"
  // preset lays out as intentional columns rather than however-many-fit-
  // on-a-line. Absent ⇒ today's flex-wrap-justify-between, unchanged.
  const columnCount = typeof config.settings.columns === "number" ? (config.settings.columns as number) : undefined;
  const topRowClass = columnCount ? "grid gap-8 pb-8 mb-6 border-b border-white/10" : "flex flex-wrap justify-between gap-8 pb-8 mb-6 border-b border-white/10";
  const topRowStyle = columnCount ? { gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` } : undefined;

  const showPaymentIcons = config.settings.showPaymentIcons === true;
  const badges = showPaymentIcons ? paymentBadges(shop) : [];

  // waveEdge (part of settings.background's "incl. wave" spec) is its own
  // boolean, not a new `background.type`, deliberately — SectionSettings's
  // background union is shared by every section's backgroundStyle(); adding
  // a 'wave' branch there for one consumer risks the same "shared token,
  // unintended consequence" class of bug the B1 radius leak taught (see
  // CLAUDE.md). fill: var(--background) is the page-canvas token (global
  // since the 2026-09-03 Colors-panel fix) — cuts a wave out of the
  // footer's own top edge, no new CSS var.
  const waveEdge = config.settings.waveEdge === true;

  // bottomBarSeparate wraps the copyright/payment row in its own tinted
  // strip — same "faint tint from the surface's own text colour" idiom the
  // 2026-09-03 header polish batch used for the header/page border.
  const bottomBarSeparate = config.settings.bottomBarSeparate === true;
  const bottomRow = (
    <div className={`flex flex-wrap items-center justify-center gap-4 ${badges.length > 0 ? "sm:justify-between" : ""}`}>
      <p
        className="text-center text-xs opacity-80"
        {...(copyrightBlock
          ? editableAttrs(previewMode, { id: copyrightBlock.id, sectionId: FOOTER_CHROME_ID, type: "copyright_text" })
          : {})}
        style={copyrightBlock ? resolveTextElementStyle(copyrightBlock.settings) : undefined}
      >
        {copyrightText}
      </p>
      {badges.length > 0 && (
        <div className="flex items-center gap-2">
          {badges.map(({ key, label, Icon }) => (
            <span key={key} className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs opacity-80">
              <Icon className="size-3.5" />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <footer style={style} className="relative py-10">
      {waveEdge && (
        <svg
          aria-hidden="true"
          viewBox="0 0 1200 24"
          preserveAspectRatio="none"
          className="absolute top-0 left-0 w-full h-6 -translate-y-full"
        >
          <path d="M0,24 C300,0 900,0 1200,24 L1200,24 L0,24 Z" fill="var(--background)" />
        </svg>
      )}
      <div className="mx-auto px-4 sm:px-6" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        {(columnBlocks.length > 0 || socialBlock || imageBlocks.length > 0) && (
          <div className={topRowClass} style={topRowStyle}>
            {columnBlocks.map((block) => (
              <FooterColumn key={block.id} block={block} sectionId={FOOTER_CHROME_ID} previewMode={previewMode} />
            ))}
            {socialBlock && <FooterSocial shop={shop} />}
            {imageBlocks.map((block) => (
              <ThemeImageBlock key={block.id} block={block} sectionId={FOOTER_CHROME_ID} previewMode={previewMode} />
            ))}
          </div>
        )}
        {bottomBarSeparate ? (
          <div
            className="-mx-4 sm:-mx-6 px-4 sm:px-6 pt-6"
            style={{ background: "color-mix(in srgb, var(--color-footer-fg) 8%, transparent)" }}
          >
            {bottomRow}
          </div>
        ) : (
          bottomRow
        )}
      </div>
      <BackToTopButton />
    </footer>
  );
}
