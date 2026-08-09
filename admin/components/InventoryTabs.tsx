"use client";

import Tabs from "@/components/ui/Tabs";

const TABS = [
  { href: "/inventory", label: "Ingredients" },
  { href: "/inventory/categories", label: "Categories" },
  { href: "/inventory/scan", label: "Scan to Stock" },
  { href: "/inventory/movements", label: "Movement History" },
];

export default function InventoryTabs() {
  return <Tabs tabs={TABS} />;
}
