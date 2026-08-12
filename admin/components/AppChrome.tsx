"use client";

import { usePathname } from "next/navigation";
import TopBar from "@/components/TopBar";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";
import NewOrderBanner from "@/components/NewOrderBanner";
import CommandPalette from "@/components/CommandPalette";

// Full-viewport routes (currently just the theme builder's three-panel
// editor) skip TopBar/banners/CommandPalette and the standard `p-6` <main>
// padding entirely. There's no route-group escape hatch for this in the App
// Router today — every route, including every pre-auth screen, renders
// through the same root layout — so a full route-group restructuring (move
// every existing route under a new `(shell)` group) would be a large,
// risky, out-of-proportion change for one new route. This pathname-
// conditional wrapper is the small alternative, and is consistent with this
// app's existing pathname-conditional chrome (TopBar itself self-hides via
// `if (!user) return null`; RequireAuth branches on a hardcoded
// PUBLIC_PATHS list) rather than a new mechanism.
const FULL_BLEED_PATTERN = /^\/theme\/[^/]+\/builder(\/|$)/;

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullBleed = FULL_BLEED_PATTERN.test(pathname);

  if (isFullBleed) {
    return <>{children}</>;
  }

  return (
    <>
      <TopBar />
      <EmailVerificationBanner />
      <NewOrderBanner />
      <CommandPalette />
      <main className="p-6">{children}</main>
    </>
  );
}
