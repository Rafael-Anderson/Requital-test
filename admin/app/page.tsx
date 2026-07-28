"use client";

import Link from "next/link";
import { LayoutDashboard, ClipboardList, Package, Settings, Users, BarChart3, Palette, Share2, Link2, Percent, ClipboardEdit, History, Layers, MailWarning, Gift } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import PageShell from "@/components/ui/PageShell";

// Categories moved under Inventory as a tab (see InventoryTabs) rather than
// its own tile — it's a sub-view of the catalog, not a peer section.
const SECTIONS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ClipboardList },
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
  { href: "/discounts", label: "Discounts", icon: Percent },
  { href: "/collections", label: "Collections", icon: Layers },
  { href: "/abandoned-carts", label: "Abandoned Carts", icon: MailWarning },
  { href: "/gift-cards", label: "Gift Cards", icon: Gift },
  { href: "/draft-orders", label: "Draft Orders", icon: ClipboardEdit },
  { href: "/activity-log", label: "Activity Log", icon: History },
];

export default function HomePage() {
  const { user } = useAuth();
  const sections = user?.role === "admin" ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;

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
        {/* Scales up to 5 columns on large screens instead of capping at 3
            inside a max-w-md (448px) box regardless of viewport — with 15
            tiles for an admin, that meant 5 rows of 3 no matter how wide the
            screen was. Still responsive down to 2 columns on narrow/mobile
            viewports, not hardcoded wide. gap-5 (was gap-3) — tiles read as
            cramped/too close together at 12px, crowding out the breathing
            room the rest of the page already has. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5 max-w-4xl mx-auto">
          {sections.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="aspect-square flex flex-col items-center justify-center gap-3 border rounded-xl p-2.5 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <span className="flex items-center justify-center size-14 rounded-2xl bg-accent/10">
                <Icon className="size-6 text-accent-text dark:text-accent" strokeWidth={1.75} />
              </span>
              <span className="text-sm font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
