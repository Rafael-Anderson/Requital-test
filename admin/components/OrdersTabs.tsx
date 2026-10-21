"use client";

import Tabs, { type TabItem } from "@/components/ui/Tabs";
import { useAuth } from "@/lib/auth-context";
import { marketplaceDeskVisible, useChannelAvailability } from "@/lib/useChannelAvailability";
import type { UserRole } from "@/lib/types";

const ALL_TABS: (TabItem & { roles: UserRole[] | null })[] = [
  { href: "/orders", label: "Live Orders", roles: null },
  { href: "/orders/history", label: "Order History", roles: null },
  // Mirrors the backend's own @Roles() on these controllers — draft-orders.controller.ts
  // (admin, order_manager) and abandoned-carts.controller.ts (admin only) — so a tab
  // never appears for a role that would just 403 clicking it.
  { href: "/orders/draft-orders", label: "Draft Orders", roles: ["admin", "order_manager"] },
  { href: "/orders/abandoned-carts", label: "Abandoned Carts", roles: ["admin"] },
  // Both reachable by every role that can view Orders — no roles
  // restriction, same as Live Orders/Order History above. Mirrors the
  // backend's own @Roles on PATCH /outlets/:id/status and the
  // method-level override on GET /reports/external-delivery.
  { href: "/orders/branch-status", label: "Branch Status", roles: null },
  { href: "/orders/external-delivery", label: "External Delivery", roles: null },
  // Mirrors the backend's @Roles('admin','branch') on drivers/delivery-runs: order_manager
  // and viewer have no dispatch access, so the tab never appears for them.
  { href: "/orders/runs", label: "Delivery Runs", roles: ["admin", "branch"] },
];

// Mirrors GET /channels/orders (admin, branch, order_manager). Shown only for a
// shop that has the feature or any connection, so every other shop sees no tab.
const MARKETPLACE_TAB: TabItem & { roles: UserRole[] | null } = { href: "/orders/marketplace", label: "Marketplace", roles: null };
const MARKETPLACE_ROLES: UserRole[] = ["admin", "branch", "order_manager"];

export default function OrdersTabs() {
  const { user } = useAuth();
  const canDesk = !!user && MARKETPLACE_ROLES.includes(user.role);
  const { data: availability } = useChannelAvailability(canDesk);
  const tabs = ALL_TABS.filter((tab) => !tab.roles || (user && tab.roles.includes(user.role)));
  if (canDesk && marketplaceDeskVisible(availability)) tabs.splice(2, 0, MARKETPLACE_TAB);

  return <Tabs tabs={tabs} />;
}
