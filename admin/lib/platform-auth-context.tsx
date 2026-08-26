"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as platformApi from "./platform-api";
import type { PlatformAdmin } from "./platform-api";

interface PlatformAuthContextValue {
  admin: PlatformAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

// Own provider, own state — deliberately not a variant of the merchant
// AuthProvider. See lib/platform-api.ts's own comment on why the two token
// spaces stay structurally separate on the frontend too.
export function PlatformAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  // Session-cookie migration (security audit finding #1): no client-
  // readable token to gate this on anymore — the httpOnly cookie rides
  // automatically, and a logged-out call just 401s fast. Always calling
  // /platform-auth/me on mount is simpler than maintaining a separate
  // readable "might be logged in" flag purely to skip one cheap request.
  useEffect(() => {
    platformApi
      .platformMe()
      .then(setAdmin)
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return platformApi.onPlatformUnauthorized(() => setAdmin(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await platformApi.platformLogin(email, password);
    setAdmin(result.admin);
  }, []);

  // Optimistic UI update, but the cookie itself only actually goes away
  // once the server responds — httpOnly means client JS can't clear it
  // directly, unlike the old localStorage-based logout.
  const logout = useCallback(async () => {
    setAdmin(null);
    await platformApi.platformLogout().catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ admin, loading, login, logout }),
    [admin, loading, login, logout],
  );

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth() {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error("usePlatformAuth must be used within PlatformAuthProvider");
  return ctx;
}
