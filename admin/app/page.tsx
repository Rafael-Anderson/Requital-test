"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard, ClipboardList, ShoppingBag, Package, Settings, Users, BarChart3, Palette, Share2, Link2, History } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getShop } from "@/lib/api";
import PageShell from "@/components/ui/PageShell";

// Collections, Templates, Discounts, and Gift Cards moved under Products as
// tabs (see ProductsTabs); Draft Orders and Abandoned Carts moved under
// Orders as tabs (see OrdersTabs) — each is a sub-view of the app it
// extends, not a peer section on its own. Products and Inventory used to be
// one combined app (product catalog + ingredient/stock tabs all under
// /inventory); Phase A made Ingredient the atomic stock unit, so they're
// now split: Products is the catalog, Inventory is stock/ingredients only.
const SECTIONS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/products", label: "Products", icon: ShoppingBag },
  { href: "/inventory", label: "Inventory", icon: Package },
];

// Admin-only — a branch account never sees the tile, and every
// settings/customers endpoint behind these is independently
// @Roles('admin')-gated server-side regardless. Customers are shop-wide
// (not outlet-scoped), same reasoning as Settings, which is why this lives
// here rather than in SECTIONS.
const ADMIN_SECTIONS = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/theme", label: "Theme", icon: Palette },
  { href: "/affiliate", label: "Affiliate", icon: Share2 },
  { href: "/bio-links", label: "Bio Links", icon: Link2 },
  { href: "/activity-log", label: "Activity Log", icon: History },
];

export default function HomePage() {
  const { user } = useAuth();
  // One getShop() fetch covering both flags this page reads — a second,
  // parallel useShopMode() call here would just re-fetch the same shop a
  // second time on every mount, since that hook's own fetch isn't shared
  // via context (see its own comment on why).
  const [shopFlags, setShopFlags] = useState<{
    mode: "simple" | "advanced";
    dynamicThemeBuilderEnabled: boolean;
  }>({ mode: "simple", dynamicThemeBuilderEnabled: false });
  const isSimple = shopFlags.mode === "simple";
  const sections = user?.role === "admin" ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;
  // Store Configuration > "Coming Soon" toggle — inert until a real dynamic
  // theme builder feature exists (see CLAUDE.md's own note on this flag).
  // Wiring it here just reflects the toggle's state on the tile itself, a
  // pure admin-UI cue — same "doesn't earn backend enforcement" pattern as
  // every other xEnabled toggle; the Theme page keeps working identically
  // either way, since this flag was never a gate for it.
  const dynamicThemeBuilderEnabled = shopFlags.dynamicThemeBuilderEnabled;

  useEffect(() => {
    getShop()
      .then((s) =>
        setShopFlags({
          mode: s.productEditorMode ?? "simple",
          dynamicThemeBuilderEnabled: s.dynamicThemeBuilderEnabled,
        }),
      )
      .catch(() => {});
  }, []);

  return (
    <PageShell>
      {/* Centered against TOTAL page height (as if the topbar weren't
          eating into it), not just the leftover space below the topbar —
          centering strictly within the leftover space (100vh minus topbar
          minus main's padding) is mathematically "centered," but its
          midpoint sits topbarHeight/2 lower than the visual center of the
          whole page, which reads as "too low." Subtracting 2x the space
          above the grid (topbar 53px + main's own 24px top padding = 77px,
          doubled = 154px) instead of that space once cancels the topbar's
          downward pull entirely: the grid's own midpoint lands exactly at
          100vh/2, with the leftover 53px (topbar's height) landing as
          unused slack below the fold instead of pushing the grid down.
          flex (not a fixed grid-height offset) because tile count varies by
          role — 15 tiles for admin vs. 3 for branch — so the content being
          centered isn't a fixed height. */}
      <div className="flex min-h-[calc(100vh-154px)] items-center justify-center">
        {/* Scales up to 4 columns on large screens instead of capping at 3
            inside a max-w-md (448px) box regardless of viewport. Capped at 4
            (not 5) and given generous padding/gap/icon size so tiles stay
            large and comfortable even with 11 tiles for an admin — an
            earlier pass shrank per-tile padding (p-6 -> p-2.5) and scaled up
            to 5 columns, which read as cramped rather than roomy; this
            restores the larger tile/icon/gap sizing. Still responsive down
            to 2 columns on narrow/mobile viewports, not hardcoded wide. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
          {sections.map(({ href, label, icon: Icon }) => {
            // Reports isn't disabled outright in simple mode — it's still a
            // real, working page — just greyed and unclickable here to keep
            // the home grid's emphasis on the focused simple-mode workflow.
            const greyed = isSimple && href === "/reports";
            if (greyed) {
              return (
                <div
                  key={href}
                  aria-disabled="true"
                  title="Switch to Advanced in Business Information to use Reports"
                  className="aspect-square flex flex-col items-center justify-center gap-3 border border-black/10 rounded-xl p-5 dark:border-white/10 opacity-40 cursor-not-allowed"
                >
                  <span className="flex items-center justify-center size-16 rounded-2xl bg-accent/10">
                    <Icon className="size-7 text-accent-text dark:text-accent" strokeWidth={1.75} />
                  </span>
                  <span className="text-sm font-medium">{label}</span>
                </div>
              );
            }
            const showDynamicThemeBadge = href === "/theme" && dynamicThemeBuilderEnabled;
            return (
              <Link
                key={href}
                href={href}
                className="relative aspect-square flex flex-col items-center justify-center gap-3 border border-black/10 rounded-xl p-5 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                {showDynamicThemeBadge && (
                  <span
                    title="Dynamic theme builder enabled"
                    className="absolute top-2 right-2 rounded-full bg-accent/15 text-accent-text dark:text-accent text-[10px] font-medium px-1.5 py-0.5"
                  >
                    Beta
                  </span>
                )}
                <span className="flex items-center justify-center size-16 rounded-2xl bg-accent/10">
                  <Icon className="size-7 text-accent-text dark:text-accent" strokeWidth={1.75} />
                </span>
                <span className="text-sm font-medium">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
