"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import BackButton from "@/components/ui/BackButton";
import SettingsNav from "@/components/SettingsNav";

// Admin-only section, with ONE exception: /settings/security is the signed-in
// user's own account security (password, sessions, two-factor), so every staff
// role reaches it. Its endpoints are scoped to the caller server-side.
// A non-admin gets bounced home from anything else, and (unlike the
// original gate, which only hid the page for a user it already knew was
// not an admin) nothing under here renders until the user is known to be an
// admin, so a new settings page can never mount and fetch for the wrong
// role. UX redirect only; every endpoint behind these pages (shop, outlets,
// branch users, jobs, webhook-log) is independently @Roles('admin')-gated
// server-side regardless of what this check does.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const ownSecurityPage = pathname === "/settings/security";

  useEffect(() => {
    if (!loading && user && user.role !== "admin" && !ownSecurityPage) router.replace("/");
  }, [loading, user, ownSecurityPage, router]);

  if (user?.role !== "admin") {
    if (!(user && ownSecurityPage)) return null;
    return (
      <div className="page-transition">
        <BackButton href="/" />
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">Security</h1>
        {children}
      </div>
    );
  }

  // The landing page is the hub, and the outlet editor has its own sidebar;
  // a second one beside it would squeeze the form.
  const showNav = pathname !== "/settings" && !/^\/settings\/outlets\/[^/]+/.test(pathname);

  return (
    <div className="page-transition">
      <BackButton href={pathname === "/settings" ? "/" : "/settings"} />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">Settings</h1>
      {showNav ? (
        <div className="flex gap-8 flex-col sm:flex-row">
          <SettingsNav />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
