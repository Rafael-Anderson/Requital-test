"use client";

import { usePathname } from "next/navigation";
import TopBar from "@/components/TopBar";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
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
  // /platform/* renders its own completely separate chrome (see
  // app/platform/layout.tsx) — the merchant TopBar/banners/CommandPalette
  // must never appear there, same reasoning as the full-bleed bypass above.
  const isPlatformPath = pathname.startsWith("/platform");

  if (isFullBleed || isPlatformPath) {
    return <>{children}</>;
  }

  return (
    <>
      <ImpersonationBanner />
      <TopBar />
      <EmailVerificationBanner />
      <NewOrderBanner />
      <CommandPalette />
      {/* 1600px/48px-side/28px-top content wrapper from the 2026-08 admin
          redesign — applied once here rather than per-page, since every page
          renders through this shared chrome (see CLAUDE.md's Page width
          convention note, which still governs which PageShell variant a page
          itself picks inside this wrapper). */}
      <main className="mx-auto max-w-[1600px] px-12 pt-7 pb-16">{children}</main>
    </>
  );
}
