"use client";

import Tabs from "@/components/ui/Tabs";
import { useAuth } from "@/lib/auth-context";

// Newsletter subscribers are a second list of people who gave this shop a
// contact detail, so they sit as a tab under Customers rather than as a new
// top-level tile, matching how Draft Orders/Abandoned Carts sit under Orders.
// Reviews (survey feedback customers agreed to publish) sits here for the same
// reason, and only for admins because its endpoints are admin-only.
// Rendered by each sibling list page (not a layout), same as OrdersTabs, so
// the /customers/[id] detail page does not get a tab bar.
const BASE_TABS = [
  { href: "/customers", label: "Customers" },
  { href: "/customers/newsletter", label: "Newsletter" },
];
const SEGMENTS_TAB = { href: "/customers/segments", label: "Segments" };
const REVIEWS_TAB = { href: "/customers/reviews", label: "Reviews" };

export default function CustomersTabs() {
  const { user } = useAuth();
  const tabs = user?.role === "admin" ? [...BASE_TABS, SEGMENTS_TAB, REVIEWS_TAB] : BASE_TABS;
  return <Tabs tabs={tabs} className="mb-6" />;
}
