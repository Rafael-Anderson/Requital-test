"use client";

import { useAuth } from "@/lib/auth-context";
import OutletSwitcher from "./OutletSwitcher";

// Branch context control for outlet-scoped pages — moved out of the global
// TopBar so it only renders where it's actually relevant. OutletSwitcher
// itself already no-ops for non-admins; guarded here too. Right-aligned,
// same convention as any other page-level filter; "Manage branches" was
// dropped as a duplicate path to Settings > Outlets, already reachable from
// the main nav.
export default function BranchBar() {
  const { user } = useAuth();
  if (!user || user.role !== "admin") return null;

  return (
    <div className="flex items-center justify-end mb-4">
      <OutletSwitcher />
    </div>
  );
}
