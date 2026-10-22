"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import Tooltip from "@/components/ui/Tooltip";
import * as api from "@/lib/api";
import { getMapsFailure, subscribeMapsFailure } from "@/lib/google-maps-loader";

// Merchant-only (F9). Tells an admin that Google Maps is broken for their store,
// with the error code so support can act on it. Two sources: this browser's own
// Maps loader (admin pages that load a map), and the beacon the STOREFRONT sends
// when a shopper's Maps fails (GET /shop/maps-health), which is the only way to
// see a referrer problem on a connected custom domain. Never shown to shoppers.
// Per session, like the other banners: a dismissed banner returns next visit.
const DISMISS_KEY = "requital_maps_health_banner_dismissed";

export default function MapsHealthBanner() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const local = useSyncExternalStore(subscribeMapsFailure, getMapsFailure, () => null);
  const [reported, setReported] = useState<api.MapsHealth["errors"][number] | null>(null);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    if (!isAdmin) return;
    // A banner must never get in the way: a failed read just means no banner.
    api
      .getMapsHealth()
      .then((health) => setReported(health.errors[0] ?? null))
      .catch(() => setReported(null));
  }, [isAdmin]);

  if (!isAdmin || dismissed || (!local && !reported)) return null;

  const code = local ? (local.code ?? "load failed") : reported!.code;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked: it just hides for this view.
    }
    setDismissed(true);
  }

  return (
    <div
      role="alert"
      data-testid="maps-health-banner"
      className="flex items-center justify-between gap-4 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 md:px-6 py-2.5 text-sm text-amber-800 dark:text-amber-300"
    >
      <span className="min-w-0 break-words">
        Google Maps is not working for your store ({code}). Contact Requital support.
        {!local && reported && (
          <span className="block text-xs opacity-80">Reported from {reported.host}.</span>
        )}
      </span>
      <Tooltip label="Hide this warning for the rest of your session" align="end">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="shrink-0 text-amber-600 dark:text-amber-400 hover:opacity-70"
        >
          <X className="size-4" />
        </button>
      </Tooltip>
    </div>
  );
}
