import type { Metadata } from "next";
import StorefrontErrorState from "@/components/StorefrontErrorState";

export const metadata: Metadata = { title: "Store not found", robots: { index: false } };

// Reached when app/[shop]/layout.tsx throws notFound() for a shop slug the API
// does not know (or a suspended shop): there is no shop to brand the page with.
export default function RootNotFound() {
  return <StorefrontErrorState variant="not-found" />;
}
