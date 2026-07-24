"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-context";
import { listOutlets } from "./api";
import type { Outlet } from "./types";

interface OutletFilterValue {
  outlets: Outlet[];
  // The outlet every outlet-scoped page (Orders, Inventory, Dashboard)
  // should filter by. null means "all branches" — only ever true for an
  // admin; a branch account is pinned to their own outlet the moment their
  // session loads, and nothing in this context can move it off that value
  // (there's no setter path that skips the role check below). The server
  // enforces this independently regardless of what this context does.
  selectedOutletId: number | null;
  setSelectedOutletId: (id: number | null) => void;
  loading: boolean;
}

const OutletFilterContext = createContext<OutletFilterValue | null>(null);

export function OutletFilterProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [selectedOutletId, setSelectedOutletIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOutlets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listOutlets()
      .then((result) => {
        setOutlets(result);
        // Branch users only ever get their own outlet back from the API, so
        // this also just naturally becomes their one outlet.
        setSelectedOutletIdState(user.role === "branch" ? user.outletId : null);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const setSelectedOutletId = useCallback(
    (id: number | null) => {
      // A branch account has no "all branches" or "someone else's branch"
      // to switch to — ignore attempts to move it. There's nothing in the
      // UI that calls this for a branch user (no switcher renders for
      // them), but this keeps the guarantee true even if something did.
      if (user?.role === "branch") return;
      setSelectedOutletIdState(id);
    },
    [user],
  );

  const value = useMemo(
    () => ({ outlets, selectedOutletId, setSelectedOutletId, loading }),
    [outlets, selectedOutletId, setSelectedOutletId, loading],
  );

  return <OutletFilterContext.Provider value={value}>{children}</OutletFilterContext.Provider>;
}

export function useOutletFilter() {
  const ctx = useContext(OutletFilterContext);
  if (!ctx) throw new Error("useOutletFilter must be used within OutletFilterProvider");
  return ctx;
}
