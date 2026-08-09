"use client";

import Tabs from "@/components/ui/Tabs";

// "/reports" would startsWith-match every sub-route too — only an exact
// match counts as active for the General Report tab itself, so it's the one
// entry left at the default `exact: true`.
const TABS = [
  { href: "/reports", label: "General Report" },
  { href: "/reports/monthly", label: "Monthly Report", exact: false },
  { href: "/reports/product-sales", label: "Product Sale Report", exact: false },
  { href: "/reports/external-delivery", label: "External Delivery Report", exact: false },
];

export default function ReportsTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
