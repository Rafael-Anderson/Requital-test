// nav_menu.settings.style — per-theme nav-link treatment (Round: theme
// visual-flaws fix, flaw A). Absent / "pill" reproduces the pre-existing
// hardcoded look byte-for-byte (rounded-full pill, text-zinc-600, no font
// override); the other treatments follow the theme's radius scale
// (.theme-round-*), the pairing's heading font (via `useHeadingFont`), and
// — importantly — `currentColor` for their own colour, so a nav sitting on a
// dark header row (Heritage's deep-green band) inherits that row's readable
// text colour instead of a hardcoded header-scheme colour. `style` is a
// free-form nav_menu block setting, so no type-mirror change is needed.
//
// Pure, no DOM — same convention as product-badge.ts / header-rows.ts.
export type NavMenuStyle = "pill" | "pill-solid" | "underline" | "caps" | "bordered";

export interface ResolvedNavLinkStyle {
  // Applied to every nav link/trigger IN ADDITION to `theme-nav-link`, the
  // optional `theme-nav-link--anim` underline class, and `whitespace-nowrap`.
  className: string;
  // When true the nav container gets `font-family: var(--theme-heading-font)`
  // so the nav reads in the theme's display face (Fraunces / Archivo Black /
  // Cormorant …), not the default sans — a bigger per-theme differentiator
  // than corner radius alone.
  useHeadingFont: boolean;
}

export function resolveNavLinkStyle(style: string | undefined): ResolvedNavLinkStyle {
  switch (style) {
    case "pill-solid":
      return {
        className:
          "theme-round-lg px-3.5 py-1.5 font-medium bg-current/10 hover:bg-current/20 transition-colors",
        useHeadingFont: true,
      };
    case "underline":
      // px-3 keeps the .theme-nav-link--anim underline (::after inset 0.75rem
      // = px-3) spanning the text.
      return {
        className: "px-3 py-1.5 opacity-85 hover:opacity-100 transition-opacity",
        useHeadingFont: true,
      };
    case "caps":
      return {
        className: "px-3 py-1.5 text-[0.8rem] uppercase tracking-[0.14em] opacity-75 hover:opacity-100 transition-opacity",
        useHeadingFont: true,
      };
    case "bordered":
      return {
        className:
          "theme-round-md border border-current/20 px-3 py-1.5 opacity-90 hover:opacity-100 hover:border-current/45 transition",
        useHeadingFont: true,
      };
    case "pill":
    default:
      // Byte-identical to the old hardcoded `linkClass`.
      return {
        className: "px-3 py-1.5 rounded-full text-zinc-600 hover:bg-mouse-over/10 transition-colors",
        useHeadingFont: false,
      };
  }
}
