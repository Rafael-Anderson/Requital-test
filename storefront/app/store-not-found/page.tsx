import type { Metadata } from "next";
import StorefrontErrorState from "@/components/StorefrontErrorState";

export const metadata: Metadata = { title: "Store not found", robots: { index: false } };

// Rewritten to by proxy.ts (see that file's own comment) when an incoming
// {subdomain}.requital.io host or connected custom domain doesn't resolve
// to any real shop — a clean page instead of the per-shop layout crashing
// on a null shop, or the request just falling through to a 404 with no
// context.
export default function StoreNotFoundPage() {
  return <StorefrontErrorState variant="not-found" />;
}
