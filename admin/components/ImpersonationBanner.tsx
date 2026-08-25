"use client";

import { useAuth } from "@/lib/auth-context";
import * as api from "@/lib/api";

// Persistent banner shown for the whole time a merchant session was minted
// via a platform admin's "Impersonate" action (see PlatformAdminService.
// impersonate / AuthService.issueImpersonationTokenForShop) — self-hides
// via the same `if (!x) return null` idiom TopBar/NewOrderBanner already
// use for their own conditional chrome. `user.impersonating` comes straight
// off GET /auth/me; nothing here trusts client state alone.
export default function ImpersonationBanner() {
  const { user } = useAuth();
  if (!user?.impersonating) return null;

  function exit() {
    // Merchant tokens only — the platform admin's own /platform session
    // token lives under a completely separate localStorage key and is
    // untouched here, so this always lands back in a live platform session.
    api.clearTokens();
    window.location.href = "/platform/shops";
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-black">
      <span>
        You are impersonating this shop as {user.name} ({user.email}). Every action you take is
        audit-logged.
      </span>
      <button
        onClick={exit}
        className="rounded-md border border-black/30 bg-black/10 px-3 py-1 text-xs font-semibold hover:bg-black/20"
      >
        Exit impersonation
      </button>
    </div>
  );
}
