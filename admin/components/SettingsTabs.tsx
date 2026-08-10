"use client";

import Tabs from "@/components/ui/Tabs";

const TABS = [
  { href: "/settings/business", label: "Business Settings", exact: false },
  { href: "/settings/outlets", label: "Outlets", exact: false },
  { href: "/settings/users", label: "Users", exact: false },
  { href: "/settings/jobs", label: "Failed Jobs", exact: false },
];

export default function SettingsTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
