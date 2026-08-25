"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as platformApi from "./platform-api";
import type { PlatformAdmin } from "./platform-api";

interface PlatformAuthContextValue {
  admin: PlatformAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

// Own provider, own state — deliberately not a variant of the merchant
// AuthProvider. See lib/platform-api.ts's own comment on why the two token
// spaces stay structurally separate on the frontend too.
export function PlatformAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!platformApi.getPlatformToken()) {
      setLoading(false);
      return;
    }
    platformApi
      .platformMe()
      .then(setAdmin)
      .catch(() => platformApi.clearPlatformToken())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return platformApi.onPlatformUnauthorized(() => setAdmin(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await platformApi.platformLogin(email, password);
    platformApi.setPlatformToken(result.accessToken);
    setAdmin(result.admin);
  }, []);

  const logout = useCallback(() => {
    platformApi.clearPlatformToken();
    setAdmin(null);
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
