import type { CSSProperties } from "react";
import { SOCIAL_ICONS } from "@/lib/social-icons";
import type { Shop } from "@/lib/types";
import type { HeaderFooterConfig, ThemeBlock } from "@/lib/theme-config-types";

interface FooterColumnSettings {
  title?: string;
  links?: { label: string; url: string }[];
}

function FooterColumn({ block }: { block: ThemeBlock }) {
  const settings = block.settings as FooterColumnSettings;
  const links = settings.links ?? [];
  if (!settings.title && links.length === 0) return null;
  return (
    <div>
      {settings.title && <p className="text-sm font-semibold mb-2">{settings.title}</p>}
      <ul className="space-y-1.5 text-sm opacity-80">
        {links.map((link, i) => (
          <li key={i}>
            <a href={link.url} className="hover:underline hover:opacity-100 transition-opacity">
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
  const blocks = [...config.blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);
  const columns = blocks.filter((b) => b.type === "footer_column");
  const socialBlock = blocks.find((b) => b.type === "footer_social");
  const copyrightBlock = blocks.find((b) => b.type === "footer_copyright");

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {(columns.length > 0 || socialBlock) && (
          <div className="flex flex-wrap justify-between gap-8 pb-8 mb-6 border-b border-white/10">
            {columns.map((block) => (
              <FooterColumn key={block.id} block={block} />
            ))}
            {socialBlock && <FooterSocial shop={shop} />}
          </div>
        )}
        <p className="text-center text-xs opacity-80">{copyrightText}</p>
      </div>
    </footer>
  );
}
