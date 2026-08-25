"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlatformAuth } from "@/lib/platform-auth-context";

// Platform-tier twin of RequireAuth.tsx — mounted only inside
// app/platform/layout.tsx, so it never runs for a merchant route. UX
// convenience only, same as the merchant version: real protection is
// PlatformAdminGuard, server-side.
export default function RequirePlatformAuth({ children }: { children: React.ReactNode }) {
  const { admin, loading } = usePlatformAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPath = pathname === "/platform/login";

  useEffect(() => {
    if (loading) return;
    if (!admin && !isLoginPath) router.replace("/platform/login");
    if (admin && isLoginPath) router.replace("/platform/shops");
  }, [loading, admin, isLoginPath, router]);

  if (loading) return null;
  if (!admin && !isLoginPath) return null;
  if (admin && isLoginPath) return null;
  return <>{children}</>;
}
