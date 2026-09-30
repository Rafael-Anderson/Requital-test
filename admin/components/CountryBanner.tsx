"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import Tooltip from "@/components/ui/Tooltip";
import * as api from "@/lib/api";

// A shop's country decides which regions (emirates, provinces, governorates) its
// address forms offer, and it can be set exactly once (ShopService.update locks
// it). A shop created before the field existed, or one that skipped it, has none,
// so its address forms have no region list until an admin picks one. Shown only
// to admins (only they can change shop settings), and per session like the
// email-verification reminder beside it: a dismissed banner returns next visit.
const DISMISS_KEY = "requital_country_banner_dismissed";

export default function CountryBanner() {
  const { user } = useAuth();
  const [missing, setMissing] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    api
      .getShop()
      .then((shop) => setMissing(!shop.country))
      .catch(() => setMissing(false));
  }, [isAdmin]);

  if (!isAdmin || !missing || dismissed) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-6 py-2.5 text-sm text-amber-800 dark:text-amber-300">
      <span>
        Set your shop&apos;s country so your address forms offer the right regions. You can only set it once.
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/settings/business/information"
          className="rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-1 text-xs font-medium hover:opacity-80"
        >
          Set country
        </Link>
        <Tooltip label="Hide this reminder for the rest of your session" align="end">
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="text-amber-600 dark:text-amber-400 hover:opacity-70"
          >
            <X className="size-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
