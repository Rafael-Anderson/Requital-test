"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import BackButton from "@/components/ui/BackButton";
import SettingsTabs from "@/components/SettingsTabs";

// Admin-only section — a branch account gets bounced home. UX redirect
// only; every settings endpoint behind these tabs (outlets, branch users,
// shop) is independently @Roles('admin')-gated server-side regardless of
// what this check does.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== "admin") router.replace("/");
  }, [loading, user, router]);

  if (user && user.role !== "admin") return null;

  return (
    <div className="page-transition">
      <BackButton href="/" />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">Settings</h1>
      <SettingsTabs />
      {children}
    </div>
  );
}
