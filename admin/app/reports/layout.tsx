"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import BackButton from "@/components/ui/BackButton";
import ReportsTabs from "@/components/ReportsTabs";

// Admin-only section — same access level as Dashboard/Customers (business
// analytics). UX redirect only; every /reports endpoint is independently
// @Roles('admin')-gated server-side regardless of what this check does.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== "admin") router.replace("/");
  }, [loading, user, router]);

  if (user && user.role !== "admin") return null;

  return (
    <div className="page-transition">
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-5">Reports</h1>
      <ReportsTabs />
      {children}
    </div>
  );
}
