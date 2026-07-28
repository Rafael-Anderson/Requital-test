"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// Just the admin-role guard now — shared by both the Theme library page
// (this segment's own page.tsx) and the tabbed editor nested under
// /theme/edit/*. The header + tabs used to live here too, but that meant
// the library page (a distinct view, not one of the editor's tabs) was
// forced to render underneath them — see /theme/edit/layout.tsx for where
// that moved. /theme and /theme/edit/* are both independently
// @Roles('admin')-gated server-side regardless of what this check does.
export default function ThemeLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== "admin") router.replace("/");
  }, [loading, user, router]);

  if (user && user.role !== "admin") return null;

  return <div className="page-transition">{children}</div>;
}
