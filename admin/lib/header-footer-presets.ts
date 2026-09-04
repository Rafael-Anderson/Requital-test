import type { HeaderFooterConfig, HeaderRow, ThemeBlock } from "@/lib/types";

// Local id generator, not imported from useThemeEditor.ts (which imports
// HEADER_PRESETS/FOOTER_PRESETS from this file) — avoids a circular import
// for what's a 1-line helper anyway.
function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// C1 — header/footer layout presets. Same shape and mechanism as
// HOMEPAGE_PRESETS (useThemeEditor.ts): a plain, entirely client-side
// literal expanded once into theme.config via the existing generic
// updateConfig + save() → PATCH /themes/:id. No backend endpoint, no stored
// preset identity — applying a preset is indistinguishable from a
// hand-built header/footer afterward (see the plan doc's §1 for the full
// reasoning). Every block/row shape here is something ThemeDrivenHeader.tsx
// / ThemeDrivenFooter.tsx already renders today — no invented capability.

function block(type: string, order: number, settings: Record<string, unknown> = {}): ThemeBlock {
  return { id: generateId("blk"), type, visible: true, order, settings };
}

function row(blockIds: string[], align: HeaderRow["align"] = "left", background?: string): HeaderRow {
  return { id: generateId("row"), blockIds, align, ...(background ? { background } : {}) };
}

export interface HeaderPreset {
  key: string;
  label: string;
  build: () => HeaderFooterConfig;
}

export interface FooterPreset {
  key: string;
  label: string;
  build: () => HeaderFooterConfig;
}

export const HEADER_PRESETS: HeaderPreset[] = [
  {
    key: "classic",
    label: "Classic",
    // Today's default — picking this is equivalent to "no preset", included
    // so the picker always has a safe, reversible-feeling first option.
    build: () => ({
      settings: { sticky: false, transparentOnHero: false },
      blocks: [
        block("logo", 0, { zone: "left" }),
        block("nav_menu", 1),
        block("search_icon", 2, { zone: "right" }),
        block("cart_icon", 3, { zone: "right" }),
        block("account_icon", 4, { zone: "right" }),
      ],
    }),
  },
  {
    key: "centered",
    label: "Centered",
    // Pure zone reassignment on the classic 3-zone grid — no rows needed.
    build: () => ({
      settings: {},
      blocks: [
        block("logo", 0, { zone: "center" }),
        block("nav_menu", 1),
        block("search_icon", 2, { zone: "right" }),
        block("cart_icon", 3, { zone: "right" }),
        block("account_icon", 4, { zone: "right" }),
      ],
    }),
  },
  {
    key: "contact-bar-centered-nav",
    label: "Contact bar + centered nav",
    build: () => {
      const contact = block("contact_bar_item", 0, { kind: "phone", value: "+971 4 000 0000", label: "Call us" });
      const logo = block("logo", 1);
      const search = block("search_icon", 2);
      const cart = block("cart_icon", 3);
      const account = block("account_icon", 4);
      const nav = block("nav_menu", 5);
      return {
        settings: {
          rows: [
            row([contact.id], "right"),
            row([logo.id, search.id, cart.id, account.id], "between"),
            row([nav.id], "center"),
          ],
        },
        blocks: [contact, logo, search, cart, account, nav],
      };
    },
  },
  {
    key: "split-nav",
    label: "Split nav",
    build: () => {
      const logo = block("logo", 0);
      const nav = block("nav_menu", 1);
      const search = block("search_icon", 2);
      const cart = block("cart_icon", 3);
      const account = block("account_icon", 4);
      return {
        settings: {
          rows: [
            row([logo.id], "center"),
            // 'between' with 4 flex children spaces nav_menu at the far
            // left and account_icon at the far right, with search/cart
            // spread between them — the closest "split" reading these
            // atomic block types (nav_menu can't itself be split in two)
            // can honestly render.
            row([nav.id, search.id, cart.id, account.id], "between"),
          ],
        },
        blocks: [logo, nav, search, cart, account],
      };
    },
  },
  {
    key: "minimal",
    label: "Minimal",
    build: () => {
      const logo = block("logo", 0);
      const cart = block("cart_icon", 1);
      // search_icon/account_icon stay in blocks (reversible via the tree)
      // but hidden — an unassigned-but-visible block would otherwise be
      // auto-appended to the last row by resolveHeaderRows, defeating the
      // "minimal" intent.
      const search = block("search_icon", 2);
      search.visible = false;
      const account = block("account_icon", 3);
      account.visible = false;
      const nav = block("nav_menu", 4);
      // nav_menu deliberately left out of every row — it keeps rendering as
      // the classic below-header MenuBar, so navigation stays fully
      // functional under an otherwise stripped-down top row.
      return {
        settings: { rows: [row([logo.id, cart.id], "between")] },
        blocks: [logo, cart, search, account, nav],
      };
    },
  },
  {
    key: "editorial",
    label: "Editorial",
    build: () => {
      const social = block("social_row", 0, { links: [] });
      const logo = block("logo", 1);
      const nav = block("nav_menu", 2);
      const search = block("search_icon", 3);
      const cart = block("cart_icon", 4);
      const account = block("account_icon", 5);
      return {
        settings: {
          rows: [
            row([social.id], "center"),
            row([logo.id], "center"),
            row([nav.id, search.id, cart.id, account.id], "center"),
          ],
        },
        blocks: [social, logo, nav, search, cart, account],
      };
    },
  },
  {
    key: "colored-band",
    label: "Colored band",
    build: () => {
      const contact = block("contact_bar_item", 0, { kind: "phone", value: "+971 4 000 0000", label: "Call us" });
      const social = block("social_row", 1, { links: [] });
      const logo = block("logo", 2);
      const nav = block("nav_menu", 3);
      const search = block("search_icon", 4);
      const cart = block("cart_icon", 5);
      const account = block("account_icon", 6);
      return {
        settings: {
          // A visible placeholder colour — a merchant applying this preset
          // is expected to swap it for their own brand colour via the same
          // row background ColorPicker HeaderSettings.tsx already exposes.
          rows: [
            row([contact.id, social.id], "right", "#2f4a3d"),
            row([logo.id, nav.id, search.id, cart.id, account.id], "between"),
          ],
        },
        blocks: [contact, social, logo, nav, search, cart, account],
      };
    },
  },
];

export const FOOTER_PRESETS: FooterPreset[] = [
  {
    key: "multi-column",
    label: "Multi-column",
    build: () => {
      const shop = block("footer_column", 0, { title: "Shop", links: [{ label: "All products", url: "/" }] });
      const company = block("footer_column", 1, { title: "Company", links: [{ label: "About us", url: "/" }] });
      const support = block("footer_column", 2, { title: "Support", links: [{ label: "Contact", url: "/" }] });
      const social = block("footer_social", 3);
      const copyright = block("footer_copyright", 4);
      return { settings: { columns: 4, showPaymentIcons: true }, blocks: [shop, company, support, social, copyright] };
    },
  },
  {
    key: "centered-stack",
    label: "Centered stack",
    // The footer catalog has no text-align setting, so this approximates
    // "centered" via a single narrow column (columns: 1) rather than
    // literal centered text — a real, honest limitation of today's
    // rendering, not silently glossed over.
    build: () => {
      const social = block("footer_social", 0);
      const copyright = block("footer_copyright", 1);
      return { settings: { columns: 1 }, blocks: [social, copyright] };
    },
  },
  {
    key: "big-cta",
    label: "Big CTA",
    // The footer catalog has no dedicated heading/CTA block type — this
    // approximates "big CTA" with a footer_column's own title + link
    // (rendered larger than body text already, per FooterColumn.tsx).
    build: () => {
      const cta = block("footer_column", 0, {
        title: "Ready to send something beautiful?",
        links: [{ label: "Shop now", url: "/" }],
      });
      const social = block("footer_social", 1);
      const copyright = block("footer_copyright", 2);
      return { settings: { columns: 1, waveEdge: true }, blocks: [cta, social, copyright] };
    },
  },
  {
    key: "one-line",
    label: "One line",
    // Today's absolute default shape — no columns row renders at all when
    // there's no footer_column/footer_social/image block.
    build: () => ({ settings: {}, blocks: [block("footer_copyright", 0)] }),
  },
  {
    key: "mega",
    label: "Mega",
    build: () => {
      const shop = block("footer_column", 0, { title: "Shop", links: [{ label: "All products", url: "/" }, { label: "New arrivals", url: "/" }] });
      const company = block("footer_column", 1, { title: "Company", links: [{ label: "About us", url: "/" }, { label: "Careers", url: "/" }] });
      const support = block("footer_column", 2, { title: "Support", links: [{ label: "Contact", url: "/" }, { label: "FAQ", url: "/" }] });
      const legal = block("footer_column", 3, { title: "Legal", links: [{ label: "Terms", url: "/" }, { label: "Privacy", url: "/" }] });
      const social = block("footer_social", 4);
      const copyright = block("footer_copyright", 5);
      return {
        settings: { columns: 5, showPaymentIcons: true, bottomBarSeparate: true },
        blocks: [shop, company, support, legal, social, copyright],
      };
    },
  },
];
