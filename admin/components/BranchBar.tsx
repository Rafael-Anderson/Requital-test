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
// back button and the page title). `right` lets a page-specific control
// (Dashboard/Reports' DateRangePicker) sit alongside the OutletSwitcher in
// that same row, matching the design handoff's back-row layout, instead of
// stacking as its own row below the page title. Non-admins get no
// OutletSwitcher, but still need `left`/`right` rendered — so the early
// return renders those alone rather than dropping the row entirely.
export default function BranchBar({ left, right }: { left?: ReactNode; right?: ReactNode } = {}) {
  const { user } = useAuth();
  if (!user || user.role !== "admin") {
    return left || right ? (
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        {left}
        {right}
      </div>
    ) : null;
  }

  return (
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
      {left}
      <div className="flex items-center gap-2.5">
        <OutletSwitcher />
        {right}
      </div>
    </div>
  );
}
