"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

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
];

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const isGuestOnlyPath = GUEST_ONLY_PATHS.includes(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath) router.replace("/login");
    if (user && isGuestOnlyPath) router.replace("/");
  }, [loading, user, isPublicPath, isGuestOnlyPath, router]);

  if (loading) return null;
  if (!user && !isPublicPath) return null;
  if (user && isGuestOnlyPath) return null;
  return <>{children}</>;
}
