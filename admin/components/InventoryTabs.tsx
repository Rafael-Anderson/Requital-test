"use client";

import Tabs from "@/components/ui/Tabs";

const TABS = [
  { href: "/inventory", label: "Ingredients" },
  { href: "/inventory/categories", label: "Categories" },
  { href: "/inventory/scan", label: "Scan to Stock" },
  { href: "/inventory/suppliers", label: "Suppliers", exact: false },
  { href: "/inventory/purchase-orders", label: "Purchase Orders", exact: false },
  { href: "/inventory/movements", label: "Movement History" },
];

export default function InventoryTabs() {
  return <Tabs tabs={TABS} />;
}
