import type { ReactNode } from "react";

// Platform-branded shell for every unauthenticated admin screen (login,
// signup, forgot/reset password, accept-invite, verify-email) — fixed
// colors throughout (zinc/white/black + the admin's own fixed --color-accent
// teal), never the merchant-customizable Theme system (that only ever
// touches the storefront, via a completely separate CSS variable set — see
// storefront/lib/shop-context.tsx). One shared component so the background/
// glow/card treatment updates everywhere at once, same reasoning as
// PageShell/ColorPicker.
//
// No image assets: the glow behind the card is a plain positioned div with
// a radial-gradient background, blurred and set to a low opacity — nothing
// to upload or store, same technique as any other CSS background.
//
// Light and dark are two deliberately different treatments, not one
// inverted onto the other:
// - Dark: flat near-black page (the same #0a0a0a the rest of the admin's
//   dark mode already uses, not a new value), a clearly visible teal glow
//   (it needs real presence against near-black to read at all — a big,
//   diffuse blur reads as intentional "soft light" against black), and a
//   translucent-white "lighter than the page" card with no border —
//   background contrast alone is what separates it.
// - Light: flat light-grey page. The glow here is deliberately smaller and
//   less blurred than dark mode's — the same 600px/130px-blur glow that
//   reads as a soft accent on black instead reads as a page-wide gradient
//   wash on a light page (its visible spread covers most of the viewport,
//   which is exactly the "the gradient is still there" bug this was tuned
//   to fix — a huge soft-edged shape IS a gradient, regardless of what
//   CSS produced it). Tighter size/blur here keeps it a contained corner
//   accent instead. Card separation comes from a deliberately stronger
//   layered shadow instead of a border (light-on-light border has ~0
//   contrast to do that job), and inputs get a custom cool-grey fill (not
//   plain zinc) with real distance from the card's white, rather than
//   relying on shadow/border to do that separation too.
// (Originally a gradient page background in both modes — flattened to a
// solid color per follow-up feedback.)
interface AuthCardProps {
  heading: string;
  subtitle?: string;
  // Only false on the login page, where "Requital" is already the heading
  // itself — showing the wordmark a second time immediately above it would
  // just repeat the same word for no reason. Every other screen has an
  // action-specific heading ("Reset your password", "Set your password", …)
  // with no existing brand mark at all, so this fills that gap. No square
  // icon/logo mark exists anywhere in this codebase (checked admin/public/
  // and grepped for one) — this reuses the existing "Requital" text
  // wordmark rather than inventing a new graphic mark, per the redesign
  // report's stated gap.
  hideWordmark?: boolean;
  // Every screen but the Account Setup wizard is a handful of stacked
  // fields, well served by the original max-w-sm. The wizard's Business/
  // Location steps use the same settings-page grid convention (2-3 columns
  // of short fields, see CLAUDE.md's "Settings/config page layout
  // convention") which needs real width to not just wrap to one column
  // anyway — so it opts into a wider card instead of a second component.
  maxWidthClassName?: string;
  children: ReactNode;
}

export default function AuthCard({
  heading,
  subtitle,
  hideWordmark,
  maxWidthClassName = "max-w-sm",
  children,
}: AuthCardProps) {
  return (
    // A single `fixed inset-0` layer, not a normal-flow wrapper — this page
    // renders inside <main className="p-6"> (app/layout.tsx), so a
    // normal-flow `min-h-screen` div here would stack its own 100vh on top
    // of main's 24px+24px padding, overflowing the real viewport by ~48px
    // for no reason (nothing lives in that extra space — see the "why can I
    // scroll" bug report). `fixed inset-0` sizes this to the true viewport
    // regardless of main's padding; `overflow-y-auto` keeps scrolling
    // available for the one case where it's real (a tall form, e.g.
    // signup's 5 fields, on a short viewport), not present otherwise.
    <div className="fixed inset-0 overflow-x-hidden overflow-y-auto bg-zinc-100 dark:bg-[#0a0a0a]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-12 h-[320px] w-[320px] rounded-full opacity-[0.24] blur-[70px] dark:-top-28 dark:-right-20 dark:h-[600px] dark:w-[600px] dark:opacity-[0.35] dark:blur-[120px]"
        style={{ background: "radial-gradient(circle, #069494 0%, transparent 70%)" }}
      />
      <div className="relative flex min-h-full items-center justify-center px-4 py-12">
        <div
          className={`w-full ${maxWidthClassName} rounded-2xl bg-white p-8 shadow-[0_4px_10px_rgba(0,0,0,0.05),0_24px_56px_-12px_rgba(0,0,0,0.20)] dark:bg-white/[0.045] dark:shadow-none dark:backdrop-blur-xl`}
        >
          <div className="text-center mb-6">
            {!hideWordmark && (
              <p className="text-xs font-semibold tracking-widest uppercase text-zinc-500 dark:text-zinc-400 mb-3">
                Requital
              </p>
            )}
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{heading}</h1>
            {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
