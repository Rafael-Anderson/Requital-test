import type { Metadata } from "next";
import type { ReactNode } from "react";

// The segment is an order's tracking token: a bearer capability. Keep it out of
// search indexes and out of the Referer header sent to anything this page links
// or loads from.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OrderConfirmationLayout({ children }: { children: ReactNode }) {
  return children;
}
