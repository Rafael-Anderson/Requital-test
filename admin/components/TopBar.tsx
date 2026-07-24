"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import OutletSwitcher from "./OutletSwitcher";
import UserMenu from "./UserMenu";

// Hidden on /login and /signup by RequireAuth not rendering children there —
// this only ever mounts once a session exists.
export default function TopBar() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-6 py-2.5 border-b border-black/10 dark:border-white/10 text-sm">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex h-6 items-center font-semibold tracking-tight shrink-0">
          Requital
        </Link>
        <OutletSwitcher />
        {user.role === "admin" && (
          <Link
            href="/settings/outlets"
            className="flex items-center gap-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            <Settings className="size-3.5" />
            Manage branches
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3">
        <UserMenu />
      </div>
    </div>
  );
}
