"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import BackButton from "@/components/ui/BackButton";
import IntegrationsTabs from "@/components/IntegrationsTabs";

// Admin-only, same UX-redirect pattern as settings/layout.tsx (staff with
// Orders access must not see this section at all) — every route behind
// these tabs (slider-settings, payment-settings, whatsapp-settings,
// webhook-log) is independently @Roles('admin')-gated server-side
// regardless of what this check does. No separate "owner" role exists in
// this codebase's 4-tier system (admin/branch/order_manager/viewer) — this
// gates on the same 'admin' role every other admin-only section does.
export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== "admin") router.replace("/");
  }, [loading, user, router]);

  if (user && user.role !== "admin") return null;

  return (
    <div className="page-transition">
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">
        Integrations
      </h1>
      <IntegrationsTabs />
      {children}
    </div>
  );
}
