"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { forgetImpersonatingShop, getRememberedImpersonatingShopId } from "@/lib/impersonation";

// Routes reachable without a session — everything else redirects to /login.
// This is a UX convenience only: every real protection is enforced
// server-side by AuthGuard regardless of what this component does.
//
// Login/signup bounce an already-authenticated visitor straight to "/" (the
// original behavior). The other three don't: a verify-email or
// reset-password link can land on a browser that's already logged in (e.g.
// clicked right after signup, same session) — bouncing away before the
// visitor can act on the link would break exactly that case.
const GUEST_ONLY_PATHS = ["/login", "/signup"];
const PUBLIC_PATHS = [
  ...GUEST_ONLY_PATHS,
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/accept-invite",
  // No session exists by the time this renders (that's the whole point) —
  // see lib/impersonation.ts.
  "/impersonation-ended",
];

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // /platform/* is a completely separate access tier with its own
  // RequirePlatformAuth guard (mounted in app/platform/layout.tsx) — this
  // merchant guard must never redirect a platform-admin visitor to /login
  // just because no merchant session exists. Same pathname-conditional
  // bypass shape AppChrome.tsx already uses for its own full-bleed routes.
  const isPlatformPath = pathname.startsWith("/platform");
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const isGuestOnlyPath = GUEST_ONLY_PATHS.includes(pathname);

  useEffect(() => {
    if (loading || isPlatformPath) return;
    if (!user && !isPublicPath) {
      // A dead impersonation token (1h expiry, non-refreshable — see
      // AuthService.issueImpersonationTokenForShop) reaches here the same
      // way any other 401 does: apiFetch clears tokens and AuthProvider's
      // onUnauthorized flips `user` to null. Route that case to a real
      // explanation instead of dumping the platform admin at a merchant
      // login screen they have no password for.
      const impersonatedShopId = getRememberedImpersonatingShopId();
      if (impersonatedShopId) {
        forgetImpersonatingShop();
        router.replace(`/impersonation-ended?shopId=${impersonatedShopId}`);
        return;
      }
      router.replace("/login");
    }
    if (user && isGuestOnlyPath) router.replace("/");
  }, [loading, user, isPublicPath, isGuestOnlyPath, isPlatformPath, router]);

  if (isPlatformPath) return <>{children}</>;
  if (loading) return null;
  if (!user && !isPublicPath) return null;
  if (user && isGuestOnlyPath) return null;
  return <>{children}</>;
}
