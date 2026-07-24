"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// Routes reachable without a session — everything else redirects to /login.
// This is a UX convenience only: every real protection is enforced
// server-side by AuthGuard regardless of what this component does.
const PUBLIC_PATHS = ["/login", "/signup"];

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPath) router.replace("/login");
    if (user && isPublicPath) router.replace("/");
  }, [loading, user, isPublicPath, router]);

  if (loading) return null;
  if (!user && !isPublicPath) return null;
  if (user && isPublicPath) return null;
  return <>{children}</>;
}
