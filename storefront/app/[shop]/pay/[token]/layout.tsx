import type { Metadata } from "next";
import type { ReactNode } from "react";

// The segment is a custom order's pay token: a bearer capability. Keep it out of
// search indexes and out of the Referer header sent to anything this page links
// or loads from (the gateway included).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CustomOrderPayLayout({ children }: { children: ReactNode }) {
  return children;
}
