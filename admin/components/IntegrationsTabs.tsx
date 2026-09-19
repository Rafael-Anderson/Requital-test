"use client";

import Tabs from "@/components/ui/Tabs";

// Delivery lives at the bare /integrations route (default tab), same
// convention as Orders' Live Orders sitting at bare /orders rather than a
// redirect wrapper.
const TABS = [
  { href: "/integrations", label: "Delivery" },
  { href: "/integrations/payments", label: "Payments" },
  { href: "/integrations/messaging", label: "Messaging" },
  // "Incoming", not "Webhooks": the page is a read-only log of deliveries
  // RECEIVED from Slider/payment gateways. The bare name reads as outbound
  // webhook management, which this app does not have at all.
  { href: "/integrations/webhooks", label: "Incoming Webhooks" },
];

export default function IntegrationsTabs() {
  return <Tabs tabs={TABS} className="mb-6" />;
}
