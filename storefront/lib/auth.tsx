"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  getStoredAuth,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  setStoredAuth,
  getMyProfile,
} from "./api";
import type { Customer } from "./types";

interface AuthContextValue {
  customer: Customer | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: { name: string; phone: string; email?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  // Re-fetches the profile and updates both React state and the persisted
  // session — called after a profile edit so the header/account pages
  // reflect it immediately without a full page reload.
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  // Loads whatever session (if any) is already persisted for this shop —
  // same mount-time hydration pattern as CartProvider, and same per-shopSlug
  // scoping so switching shops in the same tab can never show one shop's
  // login state on another's storefront.
  useEffect(() => {
    setCustomer(getStoredAuth(shopSlug)?.customer ?? null);
    setLoading(false);
  }, [shopSlug]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const result = await loginCustomer(shopSlug, { identifier, password });
      setStoredAuth(shopSlug, result);
      setCustomer(result.customer);
    },
    [shopSlug],
  );

  const register = useCallback(
    async (data: { name: string; phone: string; email?: string; password: string }) => {
      const result = await registerCustomer(shopSlug, data);
      setStoredAuth(shopSlug, result);
      setCustomer(result.customer);
    },
    [shopSlug],
  );

  const logout = useCallback(async () => {
    await logoutCustomer(shopSlug);
    setCustomer(null);
  }, [shopSlug]);

  const refreshProfile = useCallback(async () => {
    const profile = await getMyProfile(shopSlug);
    setCustomer(profile);
    const stored = getStoredAuth(shopSlug);
    if (stored) setStoredAuth(shopSlug, { ...stored, customer: profile });
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
