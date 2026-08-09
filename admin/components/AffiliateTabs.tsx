"use client";

import Tabs from "@/components/ui/Tabs";

const TABS = [
  { href: "/affiliate", label: "Affiliate" },
  { href: "/affiliate/codes", label: "Affiliate Codes", exact: false },
  { href: "/affiliate/orders", label: "Affiliate Orders", exact: false },
];

export default function AffiliateTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
