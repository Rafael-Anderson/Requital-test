"use client";

import Tabs from "@/components/ui/Tabs";

const TABS = [
  { href: "/products", label: "Products" },
  { href: "/products/categories", label: "Collections" },
  { href: "/products/templates", label: "Templates" },
  { href: "/products/discounts", label: "Discounts" },
  { href: "/products/gift-cards", label: "Gift Cards" },
];

export default function ProductsTabs() {
  return <Tabs tabs={TABS} />;
}
