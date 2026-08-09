"use client";

import Tabs from "@/components/ui/Tabs";

// Three tabs, not four — the reference's "Meta" tab (meta title/
// description/keywords/OG image) is entirely redundant with the SEO feature
// already shipped at Settings > Business > SEO, so it isn't rebuilt here.
const TABS = [
  { href: "/theme/edit/site-settings", label: "Site Settings", exact: false },
  { href: "/theme/edit/appearance-color", label: "Appearance Color", exact: false },
  { href: "/theme/edit/advanced", label: "Advanced", exact: false },
];

export default function ThemeTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
