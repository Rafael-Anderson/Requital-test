"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getShop, storefrontUrlFor } from "@/lib/api";
import UserMenu from "./UserMenu";

// Hidden on /login and /signup by RequireAuth not rendering children there —
// this only ever mounts once a session exists.
export default function TopBar() {
  const { user } = useAuth();
  // Fetched once per session (TopBar lives in the root layout and doesn't
  // remount on navigation) — a merchant flipping the publish toggle just
  // needs a refresh to see this update, same tradeoff as elsewhere in the
  // app with no live shop-state sync.
  const [storeUrl, setStoreUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getShop()
      .then((shop) => setStoreUrl(shop.published ? storefrontUrlFor(shop) : null))
      .catch(() => setStoreUrl(null));
  }, [user]);

  if (!user) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-10 py-4 text-sm dark:border-white/10 dark:bg-zinc-950">
      <Link href="/" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-extrabold text-white" aria-label="Requital home">
        R
      </Link>
      <div className="flex items-center gap-5">
        {storeUrl && (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3.5 py-2 text-[13.5px] font-semibold text-text-primary transition-colors hover:border-accent-mid hover:bg-accent-tint hover:text-accent-text dark:border-white/15 dark:bg-transparent dark:text-zinc-200 dark:hover:bg-white/10"
          >
            View store
            <ExternalLink className="size-3.5" />
          </a>
        )}
        <div className="h-[22px] w-px bg-border dark:bg-white/10" aria-hidden="true" />
        <UserMenu />
      </div>
    </div>
  );
}
