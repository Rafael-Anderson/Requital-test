"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import OutletSwitcher from "./OutletSwitcher";

// Branch context control for outlet-scoped pages — moved out of the global
// TopBar so it only renders where it's actually relevant. OutletSwitcher
// itself already no-ops for non-admins; guarded here too.
//
// `left` lets a page's BackButton share this same row instead of stacking
// above it as its own full-width block (the two used to be separate
// siblings, which left a whole empty row of vertical space between the
// back button and the page title). Non-admins get no OutletSwitcher, but
// still need `left` rendered — so the early return renders `left` alone
// rather than dropping the row entirely.
export default function BranchBar({ left }: { left?: ReactNode } = {}) {
  const { user } = useAuth();
  if (!user || user.role !== "admin") return left ? <div className="mb-4">{left}</div> : null;

  return (
    <div className="flex items-center justify-between mb-4">
      {left}
      <OutletSwitcher />
    </div>
  );
}
