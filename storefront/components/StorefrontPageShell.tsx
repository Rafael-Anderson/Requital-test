import type { ReactNode } from "react";

type Variant = "wide" | "medium" | "narrow";

// The storefront's one place page-level width is decided — mirrors the
// admin app's own PageShell (admin/components/ui/PageShell.tsx) in spirit:
// every page renders through this instead of hand-rolling its own max-w
// wrapper, which is how the storefront ended up with sign-in/cart/checkout
// floating as narrow content islands inside one blanket max-w-6xl <main>
// (see ShopLayoutClient — <main> itself is now full-bleed with no width
// constraint of its own, so a hero section can render truly edge to edge).
//
// - "wide": product-browsing pages (homepage grid, PDP, collections) — full
//   available width up to a wide cap.
// - "medium": single-column transactional/account content (cart, checkout,
//   account dashboard, order history/detail) — narrower than "wide" (a
//   line-item list or account form doesn't need 1280px), but real, centered
//   page width — not hugging the left edge of a wide container.
// - "narrow": single-action forms (sign in, register, password reset, order
//   tracking) — a centered card on a full-width tinted section, so the page
//   reads as a place, not a form abandoned in the middle of empty space.
//   max-w-lg (512px), not max-w-sm (384px, the original value) — 384px read
//   as cramped for a labeled email+password form with a submit button, even
//   though it's correctly a single-action card and not a mistake in the
//   "wide vs narrow" sense. Still clearly narrower than "medium" (672px).
export default function StorefrontPageShell({
  variant = "wide",
  children,
  className = "",
}: {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  if (variant === "narrow") {
    return (
      <div
        className="w-full py-10 sm:py-16"
        style={{ background: "color-mix(in srgb, var(--color-accent) 4%, var(--background))" }}
      >
        <div className={`max-w-lg mx-auto px-4 ${className}`}>{children}</div>
      </div>
    );
  }

  const maxWidth = variant === "medium" ? "max-w-2xl" : "max-w-7xl";
  return <div className={`mx-auto px-4 sm:px-6 py-6 sm:py-10 ${maxWidth} ${className}`}>{children}</div>;
}
