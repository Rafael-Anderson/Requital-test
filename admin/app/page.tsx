"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, ClipboardList, ShoppingBag, Package, Settings, Users, BarChart3, Palette, Share2, Link2, History, Plug } from "lucide-react";
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
//
// `group` matches the design handoff's Storefront/Growth/System kickers.
// `adminOnly` preserves the original admin-vs-branch visibility split (a
// branch account never sees Theme/Bio Links/Affiliate/Customers/Reports/
// Activity Log/Settings, each independently @Roles('admin')-gated server-
// side regardless) — it cuts across the visual grouping, not aligned with
// it, so a branch user's Storefront kicker ends up with only 4 tiles while
// admin's has 6.
interface SectionDef {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  group: "Storefront" | "Growth" | "System";
  adminOnly?: boolean;
}

const ALL_SECTIONS: SectionDef[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Sales & performance overview", group: "Storefront" },
  { href: "/orders", label: "Orders", icon: ClipboardList, description: "Track, fulfill & manage orders", group: "Storefront" },
  { href: "/products", label: "Products", icon: ShoppingBag, description: "Catalog, pricing & variants", group: "Storefront" },
  { href: "/inventory", label: "Inventory", icon: Package, description: "Stock levels & raw materials", group: "Storefront" },
  { href: "/theme", label: "Theme", icon: Palette, description: "Storefront look & layout", group: "Storefront", adminOnly: true },
  { href: "/bio-links", label: "Bio Links", icon: Link2, description: "Your link-in-bio page", group: "Storefront", adminOnly: true },
  { href: "/affiliate", label: "Affiliate", icon: Share2, description: "Partner links & commissions", group: "Growth", adminOnly: true },
  { href: "/customers", label: "Customers", icon: Users, description: "Profiles, orders & history", group: "Growth", adminOnly: true },
  { href: "/reports", label: "Reports", icon: BarChart3, description: "Exportable business insights", group: "Growth", adminOnly: true },
  { href: "/activity-log", label: "Activity Log", icon: History, description: "Every change, who & when", group: "System", adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, description: "Business info & users", group: "System", adminOnly: true },
  // Delivery/payment/messaging provider config + read-only webhook
  // diagnostics — separated from Settings since it's credential-heavy and
  // staff with plain Orders access must never see it, same adminOnly gate
  // as Settings but its own top-level tile (not a Settings sub-tab) since
  // it's a peer concern, not a business-info detail. See
  // app/integrations/layout.tsx.
  { href: "/integrations", label: "Integrations", icon: Plug, description: "Delivery, payments & messaging", group: "System", adminOnly: true },
];

const GROUP_ORDER = ["Storefront", "Growth", "System"] as const;

function greeting(name: string | undefined) {
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name}` : ""}`;
}

export default function HomePage() {
  const { user } = useAuth();
  // One getShop() fetch covering every flag this page reads — a second,
  // parallel useShopMode() call here would just re-fetch the same shop a
  // second time on every mount, since that hook's own fetch isn't shared
  // via context (see its own comment on why).
  const [shopFlags, setShopFlags] = useState<{
    mode: "simple" | "advanced";
    dynamicThemeBuilderEnabled: boolean;
    published: boolean;
  }>({ mode: "simple", dynamicThemeBuilderEnabled: false, published: false });
  const isSimple = shopFlags.mode === "simple";
  const dynamicThemeBuilderEnabled = shopFlags.dynamicThemeBuilderEnabled;
  // Computed once on mount, not a live-updating clock — matches the design
  // handoff's "Updated {time}" cue without inventing a polling/interval
  // feature this is explicitly a styling-only pass.
  const [updatedAt] = useState(() => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));

  useEffect(() => {
    getShop()
      .then((s) =>
        setShopFlags({
          mode: s.productEditorMode ?? "simple",
          dynamicThemeBuilderEnabled: s.dynamicThemeBuilderEnabled,
          published: s.published,
        }),
      )
      .catch(() => {});
  }, []);

  const visible = ALL_SECTIONS.filter((s) => !s.adminOnly || user?.role === "admin");

  return (
    <PageShell>
      <div className="mb-11 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-[28px] font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">
            {greeting(user?.name)}
          </h1>
          <p className="text-sm text-text-muted dark:text-zinc-400">Here&apos;s what&apos;s happening with your store today.</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary dark:text-zinc-300">
            <span
              className={`size-1.5 rounded-full ${shopFlags.published ? "bg-accent shadow-[0_0_0_3px_var(--color-accent-tint)]" : "bg-zinc-300 dark:bg-zinc-600"}`}
            />
            {shopFlags.published ? "Store live" : "Not published"}
          </span>
          <span className="text-[13px] text-text-faint dark:text-zinc-500">Updated {updatedAt}</span>
        </div>
      </div>

      {GROUP_ORDER.map((group) => {
        const items = visible.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="mb-10 last:mb-0">
            <div className="mb-5 flex items-center gap-3.5">
              <h2 className="whitespace-nowrap text-xs font-bold uppercase tracking-[0.09em] text-text-faint dark:text-zinc-500">
                {group}
              </h2>
              <div className="h-px flex-1 bg-border dark:bg-white/10" />
            </div>
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map(({ href, label, icon: Icon, description }) => {
                // Reports isn't disabled outright in simple mode — it's
                // still a real, working page — just greyed and unclickable
                // here to keep the home grid's emphasis on the focused
                // simple-mode workflow.
                const greyed = isSimple && href === "/reports";
                const showDynamicThemeBadge = href === "/theme" && dynamicThemeBuilderEnabled;
                const tileContent = (
                  <>
                    {showDynamicThemeBadge && (
                      <span
                        title="Dynamic theme builder enabled"
                        className="absolute top-3 right-3 rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-bold text-accent-text dark:bg-accent/15 dark:text-accent"
                      >
                        Beta
                      </span>
                    )}
                    <span className="flex size-[42px] items-center justify-center rounded-xl bg-accent-tint text-accent dark:bg-accent/15">
                      <Icon className="size-[21px]" strokeWidth={1.8} />
                    </span>
                    <div>
                      <div className="mb-1 text-[15.5px] font-bold text-text-primary dark:text-zinc-50">{label}</div>
                      <div className="text-[13px] leading-snug text-text-muted dark:text-zinc-400">{description}</div>
                    </div>
                  </>
                );
                if (greyed) {
                  return (
                    <div
                      key={href}
                      aria-disabled="true"
                      title="Switch to Advanced in Business Information to use Reports"
                      className="relative flex cursor-not-allowed flex-col items-start gap-4 rounded-2xl border border-border p-[22px] opacity-40 dark:border-white/10"
                    >
                      {tileContent}
                    </div>
                  );
                }
                return (
                  <Link
                    key={href}
                    href={href}
                    className="group relative flex flex-col items-start gap-4 rounded-2xl border border-border bg-surface p-[22px] transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-mid hover:shadow-[0_10px_28px_rgba(15,23,22,.08)] dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/30 dark:hover:shadow-none"
                  >
                    {tileContent}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </PageShell>
  );
}
