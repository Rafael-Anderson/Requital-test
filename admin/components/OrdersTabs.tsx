"use client";

import Tabs, { type TabItem } from "@/components/ui/Tabs";
import { useAuth } from "@/lib/auth-context";
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
];

export default function OrdersTabs() {
  const { user } = useAuth();
  const tabs = ALL_TABS.filter((tab) => !tab.roles || (user && tab.roles.includes(user.role)));

  return <Tabs tabs={tabs} />;
}
