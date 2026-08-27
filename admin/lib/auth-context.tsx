"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import type { AuthUser } from "./types";
import { forgetImpersonatingShop, rememberImpersonatingShop } from "./impersonation";

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
    country?: string;
    productEditorMode?: "simple" | "advanced";
  }) => Promise<{ devVerificationLink?: string }>;
  acceptInvite: (data: { token: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Starts true so RequireAuth doesn't redirect to /login before the
  // httpOnly session cookie (if any) has had a chance to be validated
  // against /auth/me.
  const [loading, setLoading] = useState(true);

  // Session-cookie migration (security audit finding #1), phase 2 — no
  // client-readable token to gate this on anymore, so /auth/me is always
  // called on mount; the cookie rides automatically and a logged-out call
  // just 401s fast (same pattern as the platform tier's own bootstrap, see
  // platform-auth-context.tsx).
  useEffect(() => {
    api
      .me()
      // A dead access cookie still gets one silent-refresh attempt inside
      // api.me() itself (apiFetch's 401 handling) before this ever rejects —
      // reaching .catch() here means the refresh cookie is gone/expired too.
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Any API call, anywhere in the app, that ends up fully logged out (both
  // the access cookie and its refresh attempt rejected) reports it here —
  // see api.onUnauthorized's own comment. This is what makes a session
  // invalidated mid-use (expired/revoked refresh cookie, or every session
  // at once if JWT_SECRET ever rotates) redirect to /login immediately via
  // RequireAuth's existing logic, instead of leaving the merchant stuck on
  // a broken page until they happen to reload.
  useEffect(() => {
    return api.onUnauthorized(() => setUser(null));
  }, []);

  // Backstop for RequireAuth's impersonation-expiry handling (see
  // lib/impersonation.ts): by the time a dead token is discovered, `user`
  // is already null, so nothing on it is left to read. Re-derives the flag
  // from the live session on every mount/refresh (not just the moment
  // startImpersonation set it) so a page reload mid-impersonation doesn't
  // lose it, and clears it once a real (non-impersonating) session is the
  // one actually active.
  useEffect(() => {
    if (!user) return;
    if (user.impersonating) rememberImpersonatingShop(user.shopId);
    else forgetImpersonatingShop();
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
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
      country?: string;
    }) => {
      const result = await api.signup(data);
      setUser(result.user);
      return result;
    },
    [],
  );

  const acceptInvite = useCallback(async (data: { token: string; password: string }) => {
    const result = await api.acceptInvite(data);
    setUser(result.user);
  }, []);

  // httpOnly cookies can only be cleared server-side — this is now an
  // awaited network round-trip, not a synchronous local-storage removal
  // (see api.logout's own comment).
  const logout = useCallback(async () => {
    await api.logout();
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
