"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import type { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Resolves with the raw signup response (not just void) so the signup
  // page can surface devVerificationLink — the dev-only stand-in for a real
  // verification email, see backend/src/common/email.ts.
  signup: (data: {
    name: string;
    email: string;
    password: string;
    shopName: string;
    subdomain: string;
    phone?: string;
    businessType?: string;
    trn?: string;
    websiteUrl?: string;
    address?: string;
    operatingModel?: string[];
    branchCount?: string;
    productEditorMode?: "simple" | "advanced";
  }) => Promise<{ devVerificationLink?: string }>;
  acceptInvite: (data: { token: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Starts true so RequireAuth doesn't redirect to /login before the stored
  // token (if any) has had a chance to be validated against /auth/me.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api.getAccessToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      // A dead access token still gets one silent-refresh attempt inside
      // api.me() itself (apiFetch's 401 handling) before this ever rejects —
      // reaching .catch() here means the refresh token is gone/expired too.
      .then(setUser)
      .catch(() => api.clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    api.setTokens(result);
    setUser(result.user);
  }, []);

  const signup = useCallback(
    async (data: {
      name: string;
      email: string;
      password: string;
      shopName: string;
      subdomain: string;
      phone?: string;
      businessType?: string;
      trn?: string;
      websiteUrl?: string;
      address?: string;
      operatingModel?: string[];
      branchCount?: string;
    }) => {
      const result = await api.signup(data);
      api.setTokens(result);
      setUser(result.user);
      return result;
    },
    [],
  );

  const acceptInvite = useCallback(async (data: { token: string; password: string }) => {
    const result = await api.acceptInvite(data);
    api.setTokens(result);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    // Fire-and-forget: tokens are cleared locally regardless of whether the
    // server-side revocation round-trip succeeds.
    void api.logout();
    api.clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signup, acceptInvite, logout }),
    [user, loading, login, signup, acceptInvite, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
