"use client";

import Tabs from "@/components/ui/Tabs";

// Newsletter subscribers are a second list of people who gave this shop a
// contact detail, so they sit as a tab under Customers rather than as a new
// top-level tile, matching how Draft Orders/Abandoned Carts sit under Orders.
// Rendered by each sibling list page (not a layout), same as OrdersTabs, so
// the /customers/[id] detail page does not get a tab bar.
const TABS = [
  { href: "/customers", label: "Customers" },
  { href: "/customers/newsletter", label: "Newsletter" },
];

export default function CustomersTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
