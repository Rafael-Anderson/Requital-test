"use client";

import Tabs from "@/components/ui/Tabs";

// Delivery lives at the bare /integrations route (default tab), same
// convention as Orders' Live Orders sitting at bare /orders rather than a
// redirect wrapper.
const TABS = [
  { href: "/integrations", label: "Delivery" },
  { href: "/integrations/payments", label: "Payments" },
  { href: "/integrations/messaging", label: "Messaging" },
  { href: "/integrations/webhooks", label: "Webhooks" },
];

export default function IntegrationsTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
