"use client";

import { useAuth } from "@/lib/auth-context";
import * as api from "@/lib/api";
import { forgetImpersonatingShop } from "@/lib/impersonation";

// Persistent, high-visibility banner shown for the whole time a merchant
// session was minted via a platform admin's "Log in as this shop" action
// (see PlatformAdminService.impersonate / AuthService.
// issueImpersonationTokenForShop) — self-hides via the same
// `if (!x) return null` idiom TopBar/NewOrderBanner already use for their
// own conditional chrome. `user.impersonating` comes straight off GET
// /auth/me; nothing here trusts client state alone. Rendered first (above
// TopBar) in AppChrome.tsx and given a distinct amber/black treatment with
// no room to mistake it for a normal notification banner.
export default function ImpersonationBanner() {
  const { user } = useAuth();
  if (!user?.impersonating) return null;

  function exit() {
    // Merchant tokens only — the platform admin's own /platform session
    // token lives under a completely separate localStorage key and is
    // untouched here, so this always lands back in a live platform session.
    forgetImpersonatingShop();
    api.clearTokens();
    window.location.href = `/platform/shops/${user!.shopId}`;
  }

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b-2 border-amber-700 bg-amber-500 px-4 py-2.5 text-sm font-bold text-black shadow-md">
      <span>
        ⚠ Viewing as <strong>{user.shopName ?? "this shop"}</strong> — you are impersonating this
        merchant. Every action is audit-logged.
      </span>
      <button
        onClick={exit}
        className="rounded-md border-2 border-black bg-black px-3 py-1 text-xs font-bold text-amber-400 hover:bg-black/80"
      >
        Exit impersonation
      </button>
    </div>
  );
}
