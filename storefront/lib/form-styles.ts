// Shared with app/[shop]/checkout/page.tsx's own copy of these same classes
// (kept there unchanged to avoid touching a working file) — new
// account/auth pages import from here instead of redefining them a third+
// time.
export const FIELD_CLASS =
  "w-full h-10 rounded-lg border-none bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--background))] px-3 text-sm outline-none transition-shadow focus:ring-[3px] focus:ring-accent/25";
export const TEXTAREA_CLASS =
  "w-full rounded-lg border-none bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--background))] px-3 py-2 text-sm outline-none transition-shadow focus:ring-[3px] focus:ring-accent/25";
export const BUTTON_OUTLINE_CLASS =
  "border border-stroke bg-background text-foreground";
export const BUTTON_PRIMARY_CLASS =
  "h-10 px-4 rounded-lg bg-button text-button-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer";
// The "card" a single-action auth-style form sits in — sign in, register,
// forgot/reset password, order tracking — on top of StorefrontPageShell's
// "narrow" tinted section background, so the form reads as a place, not a
// box floating in empty space (see StorefrontPageShell.tsx). No border —
// separation from the page's own accent-tinted background comes from the
// shadow plus the tone difference between the card's plain --background and
// the page's 4%-accent-tinted version of it, not a border line. Fully
// merchant-driven (--background/--color-accent), never a fixed color — this
// isn't the admin's own fixed-platform-teal treatment.
export const AUTH_CARD_CLASS =
  "rounded-2xl bg-background p-8 sm:p-10 shadow-[0_2px_6px_rgba(0,0,0,0.04),0_16px_40px_-12px_rgba(0,0,0,0.14)] space-y-4";
// Bold heading + (where a page already has one) a muted secondary line
// beneath — same hierarchy tightened on the admin login, applied here
// without touching any of the actual copy.
export const AUTH_HEADING_CLASS = "text-2xl font-bold";
