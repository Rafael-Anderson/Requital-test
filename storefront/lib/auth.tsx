"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { loginCustomer, logoutCustomer, registerCustomer, getMyProfile } from "./api";
import type { Customer } from "./types";

interface AuthContextValue {
  customer: Customer | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: { name: string; phone: string; email?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  // Re-fetches the profile and updates React state — called after a
  // profile edit so the header/account pages reflect it immediately
  // without a full page reload.
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  // Session-cookie migration (security audit finding #1), phase 3 — no
  // client-readable token to gate this on anymore, so this always calls
  // GET /account/profile on mount to check for a live session; the cookie
  // rides automatically and a logged-out call just fails fast. This is a
  // real behavior improvement over the old localStorage-cached-profile
  // bootstrap, not just a mechanical swap: the old version trusted a
  // possibly-stale cached `customer` object with zero server revalidation
  // on every page load — this closes that gap for free. Same per-shopSlug
  // scoping as before (the effect re-runs on shopSlug change), though
  // isolation between shops now comes from the cookie's own Path scoping
  // rather than a per-shop localStorage key.
  useEffect(() => {
    let cancelled = false;
    getMyProfile(shopSlug)
      .then((profile) => {
        if (!cancelled) setCustomer(profile);
      })
      .catch(() => {
        if (!cancelled) setCustomer(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopSlug]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const result = await loginCustomer(shopSlug, { identifier, password });
      setCustomer(result.customer);
    },
    [shopSlug],
  );

  const register = useCallback(
    async (data: { name: string; phone: string; email?: string; password: string }) => {
      const result = await registerCustomer(shopSlug, data);
      setCustomer(result.customer);
    },
    [shopSlug],
  );

  // httpOnly cookies can only be cleared server-side — logoutCustomer is
  // now an awaited network round-trip, not a synchronous local-storage
  // removal.
  const logout = useCallback(async () => {
    await logoutCustomer(shopSlug);
    setCustomer(null);
  }, [shopSlug]);

  const refreshProfile = useCallback(async () => {
    const profile = await getMyProfile(shopSlug);
    setCustomer(profile);
  }, [shopSlug]);

  return (
    <AuthContext.Provider value={{ customer, loading, login, register, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
